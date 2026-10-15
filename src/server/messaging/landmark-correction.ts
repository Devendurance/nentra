import { HttpError } from "@/server/api/errors";
import { correctionInputSchema } from "@/server/api/schemas";
import { appendEventTx, DemoRepository } from "@/server/db/repository";

const MAX_REPLY_CHARS = 2_000;
const LANDMARK_REPLY_PATTERN = /^\s*landmark\s*:\s*([\s\S]+?)\s*$/i;

export type LandmarkCorrectionResult =
  | "CORRECTION_APPLIED"
  | "INVALID_FORMAT"
  | "INVALID_LANDMARK"
  | "CASE_NOT_WAITING"
  | "INCOMPLETE_CORRECTION"
  | "ALREADY_APPLIED"
  | "CORRECTION_EXPIRED";

export interface LandmarkCandidate {
  requestId: string;
  caseId: string;
}

/**
 * Shared customer-messaging correction core. Validates a free-form
 * `LANDMARK:` reply and applies it through the existing correction
 * transaction so the same recovery run resumes. Channel modules own
 * sender authentication, deduplication, and result bookkeeping.
 */
export async function applyLandmarkText(
  repository: DemoRepository,
  candidate: LandmarkCandidate,
  textBody: string | null,
  channel: { label: string; validatedCode: string },
): Promise<LandmarkCorrectionResult> {
  if (textBody === null || textBody.length > MAX_REPLY_CHARS) {
    return "INVALID_FORMAT";
  }
  const parsed = LANDMARK_REPLY_PATTERN.exec(textBody);
  if (!parsed) return "INVALID_FORMAT";
  let landmark: string;
  try {
    landmark = correctionInputSchema.parse({ landmark: parsed[1] }).landmark as string;
  } catch {
    return "INVALID_LANDMARK";
  }

  let applied: Awaited<ReturnType<DemoRepository["applyWhatsappCorrectionByRequestId"]>>;
  try {
    applied = await repository.applyWhatsappCorrectionByRequestId(candidate.requestId, { landmark });
  } catch (error) {
    if (error instanceof HttpError && error.code === "CASE_NOT_WAITING_FOR_CUSTOMER") {
      return "CASE_NOT_WAITING";
    }
    if (error instanceof HttpError && error.code === "CORRECTION_INCOMPLETE") {
      const snapshot = await repository.getCaseSnapshot(candidate.caseId);
      if (snapshot?.run) {
        await repository.transaction(async (tx) => {
          await appendEventTx(tx, {
            caseId: candidate.caseId,
            runId: snapshot.run!.id,
            type: "TOOL_CALLED",
            actor: "liaison",
            payload: {
              title: `${channel.label} reply needs more detail`,
              summary: "The customer landmark was valid but further address details are still missing.",
              station: "liaison",
              resultCode: "INCOMPLETE_CORRECTION",
            },
          });
        });
      }
      return "INCOMPLETE_CORRECTION";
    }
    throw error;
  }

  if (applied.outcome === "ALREADY_RESOLVED") return "ALREADY_APPLIED";
  if (applied.outcome === "EXPIRED") return "CORRECTION_EXPIRED";
  const snapshot = await repository.getCaseSnapshot(candidate.caseId);
  if (snapshot?.run) {
    await repository.transaction(async (tx) => {
      await appendEventTx(tx, {
        caseId: candidate.caseId,
        runId: snapshot.run!.id,
        type: "TOOL_CALLED",
        actor: "liaison",
        payload: {
          title: `${channel.label} reply validated`,
          summary: `The customer landmark arrived over ${channel.label} and quote evaluation resumed.`,
          station: "liaison",
          resultCode: channel.validatedCode,
        },
      });
    });
  }
  return "CORRECTION_APPLIED";
}
