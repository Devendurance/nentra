"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { DecisionRail } from "./DecisionRail";
import { FloorStage } from "./FloorStage";
import { MerchantApprovalPanel } from "./MerchantApprovalPanel";
import { holdFor, projectFloor } from "./projection";
import { ReplayControls } from "./ReplayControls";
import { Timeline } from "./Timeline";
import {
  EVENT_LABELS,
  type PublicCaseSnapshot,
  STATION_NAMES,
  STATIONS,
  eventTone,
  formatNgn,
} from "./types";
import { type CaseFeed, useCaseFeed, useCaseList } from "./useCaseFeed";
import { Verification } from "./Verification";

const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";
function useReducedMotion() {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(REDUCE_QUERY);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => window.matchMedia(REDUCE_QUERY).matches,
    () => false,
  );
}

const STATUS_TONE: Record<string, string> = {
  RESOLVED: "verified",
  ESCALATED: "failed",
  CANCELLED: "failed",
  WAITING_CUSTOMER: "waiting",
  WAITING_APPROVAL: "waiting",
};

function Shell({ children, header }: { children: React.ReactNode; header?: React.ReactNode }) {
  return (
    <div className="floor-page">
      <header className="floor-header">
        <Link href="/" className="floor-brand" aria-label="Nentra home">
          <Image src="/brand/nentra/nentra-lockup-nav.png" alt="" width={480} height={105} className="h-5 w-auto" sizes="100px" />
        </Link>
        <span className="floor-name">Floor</span>
        {header}
      </header>
      <main id="main" tabIndex={-1} className="floor-main">
        {children}
      </main>
    </div>
  );
}

function StateCard({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="state-card" role="status">
      <h1 className="state-title">{title}</h1>
      <p className="state-body">{body}</p>
      {action}
    </div>
  );
}

function LoadingFloor({ label }: { label: string }) {
  return (
    <div className="state-card" role="status" aria-live="polite">
      <span className="loader" aria-hidden="true" />
      <p className="state-body">{label}</p>
    </div>
  );
}

/** /app: discovers the case through GET /api/cases instead of hardcoding database ids. */
export function FloorEntry() {
  const list = useCaseList();
  if (list.status === "loading") return <Shell><LoadingFloor label="Finding recorded cases" /></Shell>;
  if (list.status === "error")
    return (
      <Shell>
        <StateCard
          title="The floor could not reach the case API"
          body={`${list.error ?? "Request failed."} Nothing is shown in place of real data.`}
          action={<button type="button" className="btn btn-primary" onClick={list.retry}>Try again</button>}
        />
      </Shell>
    );
  if (list.cases.length === 0)
    return (
      <Shell>
        <StateCard title="No cases recorded yet" body="GET /api/cases returned no cases. Start a run from the operator tools, then reopen the floor." />
      </Shell>
    );
  return <FloorApp caseId={list.cases[0].id} others={list.cases} />;
}

export function FloorApp({ caseId, others = [] }: { caseId: string; others?: PublicCaseSnapshot[] }) {
  const feed = useCaseFeed(caseId);
  if (feed.status === "loading" && !feed.snapshot) return <Shell><LoadingFloor label="Loading the recorded case from the database" /></Shell>;
  if (feed.status === "not_found")
    return (
      <Shell>
        <StateCard
          title="Case not found"
          body="This case id is not in the public case list."
          action={<Link className="btn btn-primary" href="/app">Open the floor</Link>}
        />
      </Shell>
    );
  if (!feed.snapshot)
    return (
      <Shell>
        <StateCard
          title="The case could not be loaded"
          body={`${feed.error ?? "Request failed."} Nothing is shown in place of real data.`}
          action={<button type="button" className="btn btn-primary" onClick={feed.retry}>Try again</button>}
        />
      </Shell>
    );
  return <Floor feed={feed} snapshot={feed.snapshot} others={others} />;
}

function Floor({ feed, snapshot, others }: { feed: CaseFeed; snapshot: PublicCaseSnapshot; others: PublicCaseSnapshot[] }) {
  const { events, evidence, live } = feed;
  const reduce = useReducedMotion();
  const total = events.length;
  // null means "follow the default": the latest event when live or reduced motion, the start otherwise.
  const [chosen, setChosen] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [autoplayed, setAutoplayed] = useState(false);
  const [speed, setSpeed] = useState<1 | 2>(1);

  // A run watched live stays on its latest event when it finishes instead of rewinding.
  const followLatest = live || reduce || feed.observedLive;
  const fallback = followLatest ? total : 0;
  const index = Math.min(chosen ?? fallback, total);
  const view = useMemo(() => projectFloor(events, index), [events, index]);
  const receipt = evidence[0] ?? snapshot.evidence ?? null;

  useEffect(() => {
    if (autoplayed || followLatest || total === 0) return;
    const timer = window.setTimeout(() => {
      setAutoplayed(true);
      setChosen(0);
      setPlaying(true);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [autoplayed, followLatest, total]);

  useEffect(() => {
    if (!playing) return;
    const done = index >= total;
    const delay = index === 0 ? 500 : holdFor(events[index - 1], events[index]) / speed;
    const timer = window.setTimeout(() => {
      if (done) setPlaying(false);
      else setChosen(index + 1);
    }, done ? 0 : delay);
    return () => window.clearTimeout(timer);
  }, [playing, index, total, events, speed]);

  // Any viewer action cancels the pending autoplay so it can never override a choice.
  const seek = useCallback((next: number) => {
    setAutoplayed(true);
    setPlaying(false);
    setChosen(Math.max(0, Math.min(total, next)));
  }, [total]);
  const play = useCallback(() => {
    setAutoplayed(true);
    if (index >= total) setChosen(0);
    else setChosen(index);
    setPlaying(true);
  }, [index, total]);
  const restart = useCallback(() => {
    setAutoplayed(true);
    setChosen(0);
    setPlaying(true);
  }, []);
  const pause = useCallback(() => {
    setAutoplayed(true);
    setPlaying(false);
  }, []);

  const onKeyDown = (event: React.KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (target.closest("input, button, a")) return;
    if (event.key === " " || event.key === "k") {
      event.preventDefault();
      if (playing) pause();
      else play();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      seek(index + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      seek(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      seek(0);
    } else if (event.key === "End") {
      event.preventDefault();
      seek(total);
    }
  };

  const following = live && chosen === null;
  const mode = live ? (following ? "live" : "live-history") : "replay";
  const current = view.current;
  const recordedOn = events[0] ? new Date(events[0].occurredAt) : null;

  const header = (
    <div className="floor-meta">
      <p className="floor-order">
        <span className="order-no">{snapshot.order.orderNumber}</span>
        <span className="muted">
          {formatNgn(snapshot.order.amountNgn)} · {snapshot.order.paymentStatus.toLowerCase()} · {snapshot.order.originArea} → {snapshot.order.destinationArea}, {snapshot.order.destinationCity}
        </span>
      </p>
      <div className="chips">
        <span className={`chip tone-${STATUS_TONE[snapshot.status] ?? "active"}`}>
          <span className="sr-only">Case status </span>
          {snapshot.status}
        </span>
        <span className="chip chip-sandbox">{snapshot.merchant.mode}</span>
        <span className={`chip chip-mode is-${mode}`}>
          {mode === "replay" ? "Replay · recorded run" : mode === "live" ? "Live · watching" : "Live · viewing history"}
        </span>
        {feed.status === "reconnecting" ? <span className="chip tone-waiting">Reconnecting</span> : null}
      </div>
    </div>
  );

  return (
    <Shell header={header}>
      <h1 className="sr-only">
        Nentra Floor, order {snapshot.order.orderNumber}, case {snapshot.status}
      </h1>
      {others.length > 1 ? (
        <nav className="case-switch" aria-label="Recorded cases">
          {others.map((c) => (
            <Link key={c.id} href={`/app/cases/${c.id}`} aria-current={c.id === snapshot.id ? "page" : undefined}>
              {c.order.orderNumber} · {c.status}
            </Link>
          ))}
        </nav>
      ) : null}

      <div className="floor-top">
        <section
          id="floor-stage"
          className="stage grain"
          aria-label="Operations floor. Space plays or pauses, arrow keys step through events."
          tabIndex={0}
          onKeyDown={onKeyDown}
        >
          <div className="caption">
            <p className="caption-kicker">
              {mode === "replay"
                ? `Replaying the persisted run${recordedOn ? ` from ${recordedOn.toUTCString().slice(5, 22)} UTC` : ""}`
                : mode === "live"
                  ? "Live, following new events as they are recorded"
                  : "Viewing earlier events of a live run"}
            </p>
            {current ? (
              <p className={`caption-title tone-${eventTone(current.type)}`}>
                <span className="caption-type">{EVENT_LABELS[current.type]}</span>
                {current.payload.title}
              </p>
            ) : (
              <p className="caption-title">Order {snapshot.order.orderNumber} needs attention</p>
            )}
          </div>

          {view.outcome?.type === "CASE_RESOLVED" && receipt?.result === "PASS" ? (
            <div className="resolved-banner" role="status">
              <span className="resolved-seal" aria-hidden="true">✓</span>
              <div>
                <p className="resolved-title">Case resolved · verified booking</p>
                <p className="resolved-body">{view.outcome.payload.summary}</p>
              </div>
            </div>
          ) : null}

          <FloorStage view={view} reduce={reduce} />

          <div className="stage-foot">
            <ReplayControls
              events={events}
              index={index}
              playing={playing}
              speed={speed}
              onPlay={play}
              onPause={pause}
              onRestart={restart}
              onStep={(delta) => seek(index + delta)}
              onSeek={seek}
              onSpeed={() => setSpeed((value) => (value === 1 ? 2 : 1))}
            />
            {live && !following ? (
              <button type="button" className="btn btn-outline btn-sm" onClick={() => { setPlaying(false); setChosen(null); }}>
                Return to live
              </button>
            ) : null}
          </div>
        </section>

        <ul className="station-list" aria-label="Stations at this point in the run">
          {STATIONS.map((id) => (
            <li key={id} className={`station-item is-${view.stations[id].status}${view.focus === id ? " is-focus" : ""}`}>
              <span className="dot" aria-hidden="true" />
              <span className="station-item-name">{STATION_NAMES[id]}</span>
              <span className="station-item-status">
                {view.stations[id].status}
                {view.stations[id].status === "failed" && view.stations[id].resultCode ? ` · ${view.stations[id].resultCode}` : ""}
              </span>
            </li>
          ))}
        </ul>

        <DecisionRail view={view} events={events} snapshot={snapshot} receipt={receipt} />
      </div>

      <div className="floor-bottom">
        <Timeline
          events={events}
          index={index}
          onInspect={(next) => {
            seek(next);
            document.getElementById("floor-stage")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
          }}
        />
        <div className="floor-side">
          <MerchantApprovalPanel snapshot={snapshot} onChanged={feed.retry} />
          <Verification evidence={evidence} snapshot={snapshot} />
          <section className="panel" aria-labelledby="run-title">
            <div className="panel-head">
              <h2 id="run-title" className="panel-title">Run record</h2>
              <p className="panel-note">
                {feed.lastSyncedAt ? `Synced ${new Date(feed.lastSyncedAt).toLocaleTimeString()}` : ""}
                {live ? " · polling for new events" : " · terminal, no further polling"}
              </p>
            </div>
            <dl className="receipt-grid">
              <div>
                <dt>Case</dt>
                <dd className="mono break">{snapshot.id}</dd>
              </div>
              <div>
                <dt>Run</dt>
                <dd>
                  {snapshot.run ? `Attempt ${snapshot.run.attempt} · ${snapshot.run.status}` : "No run recorded"}
                </dd>
              </div>
              <div>
                <dt>Merchant</dt>
                <dd>{snapshot.merchant.name}</dd>
              </div>
              <div>
                <dt>Events persisted</dt>
                <dd className="tabular">{total}</dd>
              </div>
              {snapshot.run?.traceRef ? (
                <div className="span-2">
                  <dt>neatlogs trace reference</dt>
                  <dd className="mono break">{snapshot.run.traceRef}</dd>
                </div>
              ) : null}
            </dl>
            <p className="receipt-note">
              This page only reads the case, except for explicit merchant approval actions taken with the operator secret.
            </p>
          </section>
        </div>
      </div>
    </Shell>
  );
}
