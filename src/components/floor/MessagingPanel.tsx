import type { MessagingAttentionKind, MessagingPhase, MessagingState } from "./projection";

const MILESTONE_LABELS = {
  requested: "Correction requested",
  claimed: "Message send claimed",
  accepted: "Provider accepted",
  delivered: "Delivered",
  read: "Read",
  validated: "Reply validated",
  resumed: "Workflow resumed",
} as const;

function statusCopy(phase: MessagingPhase): string {
  switch (phase) {
    case "idle":
      return "No customer input requested yet.";
    case "waiting":
      return "Waiting for the customer. No message attempt recorded yet.";
    case "sending":
      return "Send claimed. Awaiting the provider response.";
    case "accepted":
      return "The provider accepted the message. Acceptance is not delivery.";
    case "delivered":
      return "The provider reports the message delivered.";
    case "read":
      return "The provider reports the message read. A read receipt is not a reply.";
    case "validated":
      return "The customer reply was validated.";
    case "resumed":
      return "Correction applied. The same workflow run resumed.";
    case "failed":
      return "The message send failed. The correction form remains available.";
    case "needs-review":
      return "The send outcome is uncertain. Manual review is required, there is no automatic retry.";
  }
}

function attentionCopy(kind: MessagingAttentionKind): string {
  switch (kind) {
    case "failed":
      return "Provider or request failure.";
    case "retryable":
      return "Failed before delivery. A bounded retry may be attempted.";
    case "needs-review":
      return "Uncertain outcome. Manual review is required.";
    case "fallback":
      return "Messaging is unavailable. The correction form remains the path.";
    case "uncontactable":
      return "No authorized contact is on file.";
    case "no-consent":
      return "No messaging consent is on record.";
    case "invalid":
      return "The stored recipient could not be used.";
    case "exhausted":
      return "Send attempts are exhausted.";
    case "ambiguous":
      return "A reply arrived but could not be matched to a single request. The order keeps waiting.";
    case "incomplete":
      return "A reply arrived but more address detail is still needed.";
  }
}

/**
 * Compact messaging lifecycle for the Customer Liaison station. Every row
 * comes from a persisted event sequence number; nothing is inferred.
 */
export function MessagingPanel({ messaging }: { messaging: MessagingState }) {
  if (!messaging.active) return null;
  const lastDone = messaging.milestones.at(-1)?.key ?? null;
  const order = Object.keys(MILESTONE_LABELS) as (keyof typeof MILESTONE_LABELS)[];
  return (
    <section className="panel" aria-labelledby="msg-title">
      <div className="panel-head">
        <h2 id="msg-title" className="panel-title">
          Customer contact
        </h2>
        <p className="panel-note">Messaging lifecycle · from persisted events</p>
      </div>
      <p className={`msg-status is-${messaging.phase}`} role="status">
        {statusCopy(messaging.phase)}
      </p>
      {messaging.attention ? (
        <p className="msg-attention" role="status">
          {attentionCopy(messaging.attention.kind)}{" "}
          <span className="ref">#{messaging.attention.seq}</span>{" "}
          <span className="code">{messaging.attention.code}</span>
        </p>
      ) : null}
      <ol className="msg-steps">
        {order.map((key) => {
          const seen = messaging.milestones.find((m) => m.key === key);
          const state = seen ? (key === lastDone ? "current" : "done") : "upcoming";
          return (
            <li key={key} className={["msg-step", `is-${state}`].join(" ")}>
              <span className="msg-dot" aria-hidden="true" />
              <span className="msg-label">{MILESTONE_LABELS[key]}</span>
              {seen ? <span className="ref">#{seen.seq}</span> : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
