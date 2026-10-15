import { BadgeCheck, CircleAlert, CircleDashed, Route, ShieldCheck, Stamp } from "lucide-react";

import { MessagingPanel } from "./MessagingPanel";

import type { FloorProjection } from "./projection";
import { stationOf } from "./projection";
import {
  ACTOR_NAMES,
  type CaseEvent,
  EVENT_LABELS,
  type PublicCaseSnapshot,
  type PublicEvidence,
  STATION_NAMES,
  eventTone,
  formatNgn,
  formatOffset,
} from "./types";

function EventRef({ event }: { event: CaseEvent }) {
  return <span className="ref">#{event.seq}</span>;
}

function Row({
  icon,
  label,
  event,
  empty,
  children,
  tone = "neutral",
}: {
  icon: React.ReactNode;
  label: string;
  event: CaseEvent | null;
  empty: string;
  children?: React.ReactNode;
  tone?: string;
}) {
  return (
    <li className={`trail-row tone-${event ? tone : "pending"}`}>
      <span className="trail-icon" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="trail-label">
          {label} {event ? <EventRef event={event} /> : null}
        </p>
        {event ? (
          <>
            <p className="trail-title">{event.payload.title}</p>
            <p className="trail-body">{event.payload.summary}</p>
            {children}
          </>
        ) : (
          <p className="trail-empty">{empty}</p>
        )}
      </div>
    </li>
  );
}

export function DecisionRail({
  view,
  events,
  snapshot,
  receipt,
}: {
  view: FloorProjection;
  events: CaseEvent[];
  snapshot: PublicCaseSnapshot;
  receipt: PublicEvidence | null;
}) {
  const current = view.current;
  const first = events[0];
  const station = current ? stationOf(current) : null;
  const passedChecks = receipt ? Object.values(receipt.checks).filter(Boolean).length : 0;
  const totalChecks = receipt ? Object.keys(receipt.checks).length : 0;

  return (
    <aside className="rail" aria-label="Decisions">
      <section className={`outcome tone-${snapshot.status === "RESOLVED" && receipt?.result === "PASS" ? "verified" : snapshot.status === "ESCALATED" ? "failed" : "neutral"}`} aria-labelledby="outcome-title">
        <p className="rail-kicker">Current case state · from the database</p>
        <h2 id="outcome-title" className="outcome-title">
          {receipt?.result === "PASS" && snapshot.status === "RESOLVED" ? (
            <>
              <BadgeCheck size={20} aria-hidden="true" /> Booking independently verified
            </>
          ) : (
            <>Case {snapshot.status.toLowerCase().replace(/_/g, " ")}</>
          )}
        </h2>
        {receipt ? (
          <p className="outcome-body">
            {receipt.result} · {passedChecks} of {totalChecks} checks · {formatNgn(receipt.amountNgn)} sandbox booking
          </p>
        ) : (
          <p className="outcome-body">No verification receipt has been recorded yet.</p>
        )}
        {receipt ? (
          <a className="outcome-link" href="#verification">
            Inspect the receipt
          </a>
        ) : null}
      </section>

      <section className="now" aria-labelledby="now-title" aria-live="polite">
        <p className="rail-kicker" id="now-title">
          {current ? `Event ${current.seq} of ${events.length}` : "Before the first event"}
          {current && first ? <span className="muted"> · {formatOffset(first.occurredAt, current.occurredAt)}</span> : null}
        </p>
        {current ? (
          <>
            <p className={`now-type tone-${eventTone(current.type)}`}>{EVENT_LABELS[current.type]}</p>
            <h3 className="now-title">{current.payload.title}</h3>
            <p className="now-summary">{current.payload.summary}</p>
            <dl className="now-meta">
              <div>
                <dt>Recorded by</dt>
                <dd>{ACTOR_NAMES[current.actor]}</dd>
              </div>
              <div>
                <dt>Station</dt>
                <dd>{station ? STATION_NAMES[station] : "None"}</dd>
              </div>
              {view.task ? (
                <div>
                  <dt>Task</dt>
                  <dd>
                    <span className="mono">{view.task.id.slice(0, 8)}</span> · {view.task.state}
                    {view.task.role ? ` · ${STATION_NAMES[view.task.role]}` : ""}
                  </dd>
                </div>
              ) : null}
              {current.payload.resultCode ? (
                <div>
                  <dt>Result</dt>
                  <dd className="mono">{current.payload.resultCode}</dd>
                </div>
              ) : null}
              {current.payload.nextAction ? (
                <div>
                  <dt>Next</dt>
                  <dd>{current.payload.nextAction}</dd>
                </div>
              ) : null}
            </dl>
          </>
        ) : (
          <p className="now-summary">Press play to step through the recorded run.</p>
        )}
      </section>

      <section aria-labelledby="trail-title">
        <p className="rail-kicker" id="trail-title">
          Decision trail · at this point in the run
        </p>
        <ul className="trail">
          <Row icon={<CircleAlert size={16} />} label="Open blocker" event={view.blocker} empty="No open blocker." tone="failed" />
          <Row icon={<Route size={16} />} label="Recovery choice" event={view.recovery} empty="Not reached yet." tone="active" />
          <Row
            icon={<Stamp size={16} />}
            label="Merchant approval"
            event={view.approvalDecision ?? view.approvalRequest}
            empty="Not requested yet."
            tone={view.approvalDecision ? "active" : "waiting"}
          >
            <p className="trail-fact">Merchant shipping ceiling: {formatNgn(snapshot.merchant.maxShippingNgn)}</p>
          </Row>
          <Row
            icon={view.verification ? <ShieldCheck size={16} /> : <CircleDashed size={16} />}
            label="Evidence"
            event={view.verification}
            empty="No verification recorded yet."
            tone={view.verification?.type === "VERIFICATION_PASSED" ? "verified" : "failed"}
          />
        </ul>
      </section>

      <MessagingPanel messaging={view.messaging} />
    </aside>
  );
}
