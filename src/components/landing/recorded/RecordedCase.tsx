"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

import type { CaseEvent, PublicCaseSnapshot, PublicEvidence } from "@/components/floor/types";
import { getJson, mergeEvents } from "@/components/floor/useCaseFeed";

import { type Beat, type RecordedFacts, buildBeats, pickRecordedCase, recordedFacts } from "./beats";

import "./recorded.css";

export type RecordedStatus = "loading" | "ready" | "empty" | "error";

export type RecordedCase = {
  status: RecordedStatus;
  snapshot: PublicCaseSnapshot | null;
  events: CaseEvent[];
  beats: Beat[];
  facts: RecordedFacts | null;
  error: string | null;
  retry: () => void;
};

type Loaded = { snapshot: PublicCaseSnapshot; events: CaseEvent[]; evidence: PublicEvidence[] };

const Ctx = createContext<RecordedCase | null>(null);

/**
 * Loads the newest resolved, verified case once, after hydration, using the same public
 * read endpoints as Nentra Floor. The landing renders immediately and never waits on it.
 * There is no fallback data: a failed read is shown as a failed read.
 */
export function RecordedCaseProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ status: RecordedStatus; data: Loaded | null; error: string | null }>({
    status: "loading",
    data: null,
    error: null,
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const load = async (): Promise<Loaded | null> => {
      const { cases } = await getJson<{ cases: PublicCaseSnapshot[] }>("/api/cases", signal);
      const snapshot = pickRecordedCase(cases);
      if (!snapshot) return null;
      const base = `/api/cases/${encodeURIComponent(snapshot.id)}`;
      const [eventBody, evidenceBody] = await Promise.all([
        getJson<{ events: CaseEvent[] }>(`${base}/events?after=0`, signal),
        getJson<{ evidence: PublicEvidence[] }>(`${base}/evidence`, signal),
      ]);
      return { snapshot, events: mergeEvents([], eventBody.events) ?? [], evidence: evidenceBody.evidence };
    };
    // Transient read failures are retried twice with backoff before the error is shown.
    const withRetry = async (tries = 3): Promise<Loaded | null> => {
      for (let i = 1; ; i++) {
        try {
          return await load();
        } catch (cause) {
          if (signal.aborted || i >= tries) throw cause;
          await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** (i - 1)));
        }
      }
    };
    withRetry()
      .then((data) => {
        if (signal.aborted) return;
        setState(data ? { status: "ready", data, error: null } : { status: "empty", data: null, error: null });
      })
      .catch((cause) => {
        if (signal.aborted) return;
        setState({ status: "error", data: null, error: cause instanceof Error ? cause.message : "The recorded run could not be loaded." });
      });
    return () => controller.abort();
  }, [attempt]);

  const value = useMemo<RecordedCase>(() => {
    const data = state.data;
    return {
      status: state.status,
      snapshot: data?.snapshot ?? null,
      events: data?.events ?? [],
      beats: data ? buildBeats(data.events) : [],
      facts: data ? recordedFacts(data.events, data.evidence) : null,
      error: state.error,
      retry: () => {
        setState({ status: "loading", data: null, error: null });
        setAttempt((n) => n + 1);
      },
    };
  }, [state]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRecordedCase(): RecordedCase {
  const value = useContext(Ctx);
  if (!value) throw new Error("useRecordedCase must be used inside RecordedCaseProvider");
  return value;
}

/** Inline state line for any panel that reads the recorded run. */
export function RecordedState({ compact = false }: { compact?: boolean }) {
  const { status, error, retry } = useRecordedCase();
  if (status === "ready") return null;
  if (status === "loading")
    return (
      <p className="rec-state" role="status" data-compact={compact}>
        <span className="rec-dot" aria-hidden="true" />
        Reading the recorded run from the case API
      </p>
    );
  if (status === "empty")
    return (
      <p className="rec-state" role="status" data-compact={compact}>
        No verified recovery has been recorded yet, so there is nothing to show here.
      </p>
    );
  return (
    <div className="rec-state is-error" role="alert" data-compact={compact}>
      <span>The recorded run couldn&apos;t be loaded{error ? `: ${error}` : "."}</span>
      <button type="button" className="rec-retry" onClick={retry}>
        Try again
      </button>
    </div>
  );
}
