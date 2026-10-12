"use client";

import { ArrowDown, Check, ShieldCheck, X } from "lucide-react";
import { useRef } from "react";

import { ACTOR_NAMES, type CaseEvent, STATION_NAMES, formatClock, formatNgn, isStation } from "@/components/floor/types";

import { RecordedState, useRecordedCase } from "./recorded/RecordedCase";
import { useInView } from "./scroll-motion";

import "./bento.css";

const ref = (e: CaseEvent | null) => (e ? `#${String(e.seq).padStart(2, "0")} · ${ACTOR_NAMES[e.actor]}` : null);

const CHECK_NAMES: Record<string, string> = {
  bookingIdentity: "Booking identity",
  order: "Order",
  status: "Status",
  courier: "Courier",
  price: "Price",
  uniqueness: "Single booking",
};

function Tile({
  className,
  tint,
  tilt,
  label,
  caption,
  title,
  body,
  children,
}: {
  className?: string;
  tint: string;
  tilt: string;
  label: string;
  caption: string;
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <article className={`bento-tile proof-tile ${className ?? "bento-4"}`} style={{ "--tile": tint } as React.CSSProperties}>
      <div className="proof-text">
        <p className="proof-caption">{caption}</p>
        <span className="tile-label" style={{ "--tilt": tilt } as React.CSSProperties}>
          {label}
        </span>
        <h3 className="proof-title">{title}</h3>
        <p className="proof-body">{body}</p>
      </div>
      <div className="proof-visual">{children}</div>
    </article>
  );
}

function Pending() {
  const { status } = useRecordedCase();
  if (status === "loading") return <span className="proof-skel" aria-hidden="true" />;
  return <p className="proof-unavailable">{status === "empty" ? "Nothing recorded yet." : "Unavailable right now."}</p>;
}

function Investigation() {
  const { snapshot, facts } = useRecordedCase();
  const finding = facts?.finding ?? null;
  const order = snapshot?.order;
  const missingLandmark = !!finding && /landmark/i.test(finding.payload.summary);
  return (
    <Tile
      className="bento-8 proof-wide"
      tint="var(--tint-rust)"
      tilt="-3deg"
      label="Investigation"
      caption="Investigate, not just alert"
      title="Start with evidence, not guesswork."
      body="The Investigator checks the order's required delivery fields and names the gap before anyone acts on it."
    >
      {order && finding ? (
        <div className="inv">
          <div className="inv-lens">
            <p className="inv-order">
              {order.orderNumber} · {formatNgn(order.amountNgn)}
            </p>
            <dl className="inv-fields">
              {[
                ["Origin", order.originArea],
                ["Destination", order.destinationArea],
                ["City", order.destinationCity],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>
                    {v} <Check aria-label="present" size={13} strokeWidth={3} className="text-verified" />
                  </dd>
                </div>
              ))}
              {missingLandmark ? (
                <div className="is-missing">
                  <dt>Landmark</dt>
                  <dd>
                    Missing <X aria-hidden="true" size={13} strokeWidth={3} />
                  </dd>
                </div>
              ) : null}
            </dl>
          </div>
          <blockquote className="inv-quote">
            <p>&ldquo;{finding.payload.summary}&rdquo;</p>
            <footer>{ref(finding)}</footer>
          </blockquote>
        </div>
      ) : (
        <Pending />
      )}
    </Tile>
  );
}

const SPOKES: Record<string, readonly [number, number]> = {
  investigator: [-62, -44],
  verifier: [62, -44],
  liaison: [-74, 30],
  recovery: [74, 30],
  fulfillment: [0, 70],
};

function Handoffs() {
  const { facts } = useRecordedCase();
  const box = useRef<HTMLDivElement>(null);
  const inView = useInView(box);
  const roles = (facts?.handoffRoles ?? []).filter((r) => r !== "controller" && r in SPOKES);
  return (
    <Tile
      tint="var(--tint-olive)"
      tilt="3deg"
      label="Handoffs"
      caption="Coordinate, not just recommend"
      title="Every task has an owner."
      body="The Controller hands each step to one specialist, so nothing waits without someone responsible for it."
    >
      {facts ? (
        <div ref={box} className="hand" data-inview={inView}>
          <svg viewBox="-100 -80 200 170" aria-hidden="true">
            {roles.map((r, i) => {
              const [x, y] = SPOKES[r];
              return (
                <g key={r}>
                  <line x1="0" y1="0" x2={x} y2={y} />
                  <circle className="hand-token" r="3" style={{ "--x": `${x}px`, "--y": `${y}px`, animationDelay: `${i * 0.6}s` } as React.CSSProperties} />
                  <circle className="hand-node" cx={x} cy={y} r="6" />
                </g>
              );
            })}
            <circle className="hand-core" r="11" />
          </svg>
          <p className="hand-count">
            <strong>{facts.delegations}</strong>
            <span>
              task delegations across {roles.length} specialists:{" "}
              {roles.map((r) => (isStation(r) ? STATION_NAMES[r] : r)).join(", ")}
            </span>
          </p>
        </div>
      ) : (
        <Pending />
      )}
    </Tile>
  );
}

function Recovery() {
  const { facts } = useRecordedCase();
  const failure = facts?.failure ?? null;
  const fallback = facts?.fallback ?? null;
  return (
    <Tile
      tint="var(--tint-dust)"
      tilt="-2deg"
      label="Recovery"
      caption="Failure is information"
      title="A failed quote becomes a decision."
      body="When the preferred route fails, Recovery classifies it and selects an eligible alternative."
    >
      {failure && fallback ? (
        <ol className="rec">
          <li className="rec-step is-failed">
            <span className="rec-code">{failure.payload.resultCode ?? "FAILED"}</span>
            <strong>{failure.payload.title}</strong>
            <span className="rec-ref">{ref(failure)}</span>
          </li>
          <li className="rec-arrow" aria-hidden="true">
            <ArrowDown size={16} />
          </li>
          <li className="rec-step is-ok">
            <strong>{fallback.payload.title}</strong>
            <span className="rec-sum">{fallback.payload.summary}</span>
            <span className="rec-ref">{ref(fallback)}</span>
          </li>
        </ol>
      ) : (
        <Pending />
      )}
    </Tile>
  );
}

function Approval() {
  const { snapshot, facts } = useRecordedCase();
  const ceiling = snapshot?.merchant.maxShippingNgn ?? null;
  const amount = facts?.receipt?.amountNgn ?? null;
  const grant = facts?.approvalGrant ?? null;
  const pct = ceiling && amount ? Math.min(100, (ceiling / amount) * 100) : 0;
  return (
    <Tile
      tint="var(--tint-umber)"
      tilt="2deg"
      label="Approval"
      caption="Control with evidence"
      title="Spend above your limit waits for you."
      body="A quote above the merchant's shipping ceiling pauses until the merchant decides."
    >
      {ceiling && amount && grant ? (
        <div className="appr">
          <div className="appr-meter" style={{ "--pct": `${pct}%` } as React.CSSProperties} aria-hidden="true">
            <span />
          </div>
          <dl className="appr-nums">
            <div>
              <dt>Ceiling</dt>
              <dd>{formatNgn(ceiling)}</dd>
            </div>
            <div>
              <dt>Approved</dt>
              <dd>{formatNgn(amount)}</dd>
            </div>
            <div>
              <dt>Over by</dt>
              <dd>{formatNgn(Math.max(0, amount - ceiling))}</dd>
            </div>
          </dl>
          <p className="appr-grant">
            <Check aria-hidden="true" size={14} strokeWidth={3} /> {grant.payload.title}
            <span className="rec-ref">{ref(grant)}</span>
          </p>
        </div>
      ) : (
        <Pending />
      )}
    </Tile>
  );
}

function Evidence() {
  const { facts } = useRecordedCase();
  const receipt = facts?.receipt ?? null;
  return (
    <Tile
      tint="var(--tint-smoke)"
      tilt="-3deg"
      label="Evidence"
      caption="Verify, do not assume"
      title="A receipt, not a claim."
      body="An independent readback is compared with the approved booking before the case resolves."
    >
      {receipt ? (
        <div className="evd">
          <p className="evd-seal" data-result={receipt.result}>
            <ShieldCheck aria-hidden="true" size={16} /> {receipt.result} · {receipt.adapterMode}
          </p>
          <ul className="evd-checks">
            {Object.entries(receipt.checks).map(([k, ok]) => (
              <li key={k} data-ok={ok}>
                {ok ? <Check aria-label="passed" size={12} strokeWidth={3} /> : <X aria-label="failed" size={12} strokeWidth={3} />}
                {CHECK_NAMES[k] ?? k}
              </li>
            ))}
          </ul>
          <p className="rec-ref">Read back {formatClock(receipt.verifiedAt)}</p>
        </div>
      ) : (
        <Pending />
      )}
    </Tile>
  );
}

export function ProofBento() {
  const { snapshot } = useRecordedCase();
  return (
    <section id="proof" className="proof" aria-labelledby="proof-title">
      <div className="container-n">
        <div className="max-w-3xl">
          <p className="eyebrow-pill">From the recorded run</p>
          <h2 id="proof-title" className="h2 mt-6">
            Every step has a reason and a <span className="serif-accent">record.</span>
          </h2>
          <p className="lead mt-5 max-w-2xl">
            These panels read the same sanitized case API as Nentra Floor. The figures, codes and quotes below come from the
            persisted events and verification receipt, not from this page.
          </p>
          <div className="mt-6">
            <RecordedState />
          </div>
        </div>

        <div className="glass bento proof-bento mt-12 lg:mt-16">
          <Investigation />
          <Handoffs />
          <Recovery />
          <Approval />
          <Evidence />
        </div>
        <p className="proof-source">
          {snapshot
            ? `Source: GET /api/cases/{id}/events and /evidence for order ${snapshot.order.orderNumber} · ${snapshot.merchant.mode} · fictional demo data`
            : "Source: the public case API · fictional demo data"}
        </p>
      </div>
    </section>
  );
}
