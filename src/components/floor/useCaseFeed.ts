"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { type CaseEvent, type PublicCaseSnapshot, type PublicEvidence, TERMINAL_STATUSES } from "./types";

export type FeedStatus = "loading" | "ready" | "reconnecting" | "error" | "not_found";

export type CaseFeed = {
  status: FeedStatus;
  snapshot: PublicCaseSnapshot | null;
  events: CaseEvent[];
  evidence: PublicEvidence[];
  error: string | null;
  lastSyncedAt: number | null;
  live: boolean;
  /** True once this session has seen the case in a non-terminal state. */
  observedLive: boolean;
  retry: () => void;
};

const POLL_MS = 2000;
const MAX_BACKOFF_MS = 15000;

class FeedError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, cache: "no-store", headers: { accept: "application/json" } });
  if (!response.ok) {
    let message = `Request failed with ${response.status}.`;
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      if (body.error?.message) message = body.error.message;
    } catch {}
    throw new FeedError(message, response.status);
  }
  return (await response.json()) as T;
}

/** Appends ordered event deltas. Returns null when a gap means the cursor must be rebuilt. */
export function mergeEvents(current: CaseEvent[], incoming: CaseEvent[]): CaseEvent[] | null {
  if (incoming.length === 0) return current;
  const sorted = [...incoming].sort((a, b) => a.seq - b.seq);
  const next = [...current];
  let last = next.at(-1)?.seq ?? 0;
  for (const event of sorted) {
    if (event.seq <= last) continue;
    if (event.seq !== last + 1) return null;
    next.push(event);
    last = event.seq;
  }
  return next;
}

/**
 * Read-only feed for one case: the authoritative snapshot, the ordered persisted events
 * and verification receipts. Non-terminal cases are observed with cursor polling. Nothing
 * here can start, reset, approve or otherwise mutate a workflow.
 */
export function useCaseFeed(caseId: string): CaseFeed {
  const [snapshot, setSnapshot] = useState<PublicCaseSnapshot | null>(null);
  const [events, setEvents] = useState<CaseEvent[]>([]);
  const [evidence, setEvidence] = useState<PublicEvidence[]>([]);
  const [status, setStatus] = useState<FeedStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [observedLive, setObservedLive] = useState(false);
  const eventsRef = useRef<CaseEvent[]>([]);

  const retry = useCallback(() => {
    setStatus("loading");
    setError(null);
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const base = `/api/cases/${encodeURIComponent(caseId)}`;
    let timer = 0;
    let failures = 0;
    let stopped = false;
    let knownReceipt: string | null = null;
    eventsRef.current = [];

    const sync = async (full: boolean) => {
      const after = full ? 0 : (eventsRef.current.at(-1)?.seq ?? 0);
      // The initial load fetches receipts in parallel, later polls only when the receipt changes.
      const [caseBody, eventBody, initialEvidence] = await Promise.all([
        getJson<{ case: PublicCaseSnapshot }>(base, signal),
        getJson<{ events: CaseEvent[] }>(`${base}/events?after=${after}`, signal),
        full ? getJson<{ evidence: PublicEvidence[] }>(`${base}/evidence`, signal) : Promise.resolve(null),
      ]);
      let merged = mergeEvents(full ? [] : eventsRef.current, eventBody.events);
      if (!merged) {
        // A gap in sequence numbers: rebuild from the start instead of guessing.
        const rebuilt = await getJson<{ events: CaseEvent[] }>(`${base}/events?after=0`, signal);
        merged = mergeEvents([], rebuilt.events) ?? [];
      }
      const snap = caseBody.case;
      // Receipts only change when the snapshot points at a different one, so polling stays light.
      const receiptId = snap.evidence?.id ?? null;
      const evidenceBody =
        initialEvidence ??
        (receiptId !== knownReceipt ? await getJson<{ evidence: PublicEvidence[] }>(`${base}/evidence`, signal) : null);
      if (signal.aborted) return snap;
      eventsRef.current = merged;
      setEvents(merged);
      setSnapshot(snap);
      if (!TERMINAL_STATUSES.has(snap.status)) setObservedLive(true);
      if (evidenceBody) {
        knownReceipt = receiptId;
        setEvidence(evidenceBody.evidence);
      }
      setLastSyncedAt(Date.now());
      return snap;
    };

    const loop = async (full: boolean) => {
      try {
        const snap = await sync(full);
        if (stopped) return;
        failures = 0;
        setStatus("ready");
        setError(null);
        if (!TERMINAL_STATUSES.has(snap.status)) timer = window.setTimeout(() => loop(false), POLL_MS);
      } catch (cause) {
        if (stopped || signal.aborted) return;
        if (cause instanceof FeedError && cause.status === 404) {
          setStatus("not_found");
          setError(cause.message);
          return;
        }
        failures += 1;
        setError(cause instanceof Error ? cause.message : "The case could not be loaded.");
        const hasData = eventsRef.current.length > 0;
        setStatus(hasData ? "reconnecting" : "error");
        if (!hasData && failures >= 3) return;
        timer = window.setTimeout(() => loop(!hasData), Math.min(MAX_BACKOFF_MS, 1000 * 2 ** failures));
      }
    };

    loop(true);
    return () => {
      stopped = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [caseId, attempt]);

  const live = !!snapshot && !TERMINAL_STATUSES.has(snapshot.status);
  return { status, snapshot, events, evidence, error, lastSyncedAt, live, observedLive, retry };
}

/** Discovers cases through GET /api/cases. */
export function useCaseList() {
  const [state, setState] = useState<{
    status: "loading" | "ready" | "error";
    cases: PublicCaseSnapshot[];
    error: string | null;
  }>({ status: "loading", cases: [], error: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    getJson<{ cases: PublicCaseSnapshot[] }>("/api/cases", controller.signal)
      .then((body) => {
        const cases = [...body.cases].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        setState({ status: "ready", cases, error: null });
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setState({ status: "error", cases: [], error: cause instanceof Error ? cause.message : "Cases could not be loaded." });
      });
    return () => controller.abort();
  }, [attempt]);

  return {
    ...state,
    retry: () => {
      setState({ status: "loading", cases: [], error: null });
      setAttempt((value) => value + 1);
    },
  };
}
