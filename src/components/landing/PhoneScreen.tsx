"use client";

import { Check, CircleAlert, ShieldCheck } from "lucide-react";
import Image from "next/image";

import { ACTOR_NAMES, type CaseEvent, eventTone, formatClock, formatNgn } from "@/components/floor/types";

import type { Beat } from "./recorded/beats";
import { humanize } from "./recorded/beats";
import { useRecordedCase } from "./recorded/RecordedCase";

const pad = (n: number) => `#${String(n).padStart(2, "0")}`;

function Row({ event, shown, order, latest }: { event: CaseEvent; shown: boolean; order: number; latest: boolean }) {
  const { snapshot, facts } = useRecordedCase();
  const tone = eventTone(event.type);
  const style = { "--o": order } as React.CSSProperties;
  const meta = (
    <span className="ph-meta">
      {pad(event.seq)} · {ACTOR_NAMES[event.actor]}
    </span>
  );

  if (event.type === "APPROVAL_REQUIRED" && snapshot) {
    const ceiling = snapshot.merchant.maxShippingNgn;
    const amount = facts?.receipt?.amountNgn ?? null;
    const pct = amount ? Math.min(100, (ceiling / amount) * 100) : 100;
    return (
      <li className="ph-card ph-approval" data-shown={shown} style={style}>
        {meta}
        <strong className="ph-title">{event.payload.title}</strong>
        {amount ? (
          <div className="ph-meter" aria-hidden="true" style={{ "--pct": `${pct}%` } as React.CSSProperties}>
            <span className="ph-meter-mark" />
          </div>
        ) : null}
        <dl className="ph-amounts">
          <div>
            <dt>Ceiling</dt>
            <dd>{formatNgn(ceiling)}</dd>
          </div>
          {amount ? (
            <div>
              <dt>Quote</dt>
              <dd>{formatNgn(amount)}</dd>
            </div>
          ) : null}
        </dl>
      </li>
    );
  }

  if (event.type === "VERIFICATION_PASSED") {
    const receipt = facts?.receipt;
    const checks = receipt ? Object.values(receipt.checks) : [];
    return (
      <li className="ph-card ph-pass" data-shown={shown} style={style}>
        <span className="ph-seal" aria-hidden="true">
          <ShieldCheck size={18} strokeWidth={2} />
        </span>
        <div>
          {meta}
          <strong className="ph-title">{event.payload.title}</strong>
          {receipt ? (
            <span className="ph-sub">
              {receipt.result} · {checks.filter(Boolean).length}/{checks.length} checks · {receipt.adapterMode}
            </span>
          ) : null}
        </div>
      </li>
    );
  }

  return (
    <li className="ph-row" data-tone={tone} data-shown={shown} data-latest={latest} style={style}>
      <span className="ph-pip" aria-hidden="true">
        {tone === "failed" ? <CircleAlert size={12} strokeWidth={2.4} /> : tone === "verified" ? <Check size={12} strokeWidth={3} /> : null}
      </span>
      <div className="min-w-0">
        {meta}
        <strong className="ph-title">
          {event.payload.title}
          {event.payload.resultCode && tone === "failed" ? <span className="ph-code">{event.payload.resultCode}</span> : null}
        </strong>
        <span className="ph-sub">{event.payload.summary}</span>
      </div>
    </li>
  );
}

/**
 * A presentation of the recorded run in a phone-shaped frame. It is not a shipped mobile app.
 * Every row is a persisted event. `visible` is how many rows the scroll position has revealed.
 */
export function PhoneScreen({ beat, index, visible = Infinity }: { beat: Beat | undefined; index: number; visible?: number }) {
  const { status, snapshot, events } = useRecordedCase();
  const order = snapshot?.order;
  const anchor = beat?.anchor ?? null;
  const total = events.length;
  const time = anchor ? formatClock(anchor.occurredAt).slice(0, 5) : "--:--";

  let body: React.ReactNode;
  if (status === "ready" && beat && anchor) {
    body = (
      <>
        {index === 0 && order ? (
          <div className="ph-order" data-shown="true">
            <span className="ph-meta">Order {order.orderNumber}</span>
            <strong className="ph-amount">{formatNgn(order.amountNgn)}</strong>
            <span className="ph-sub">
              {humanize(order.paymentStatus)} · {order.originArea} to {order.destinationArea}, {order.destinationCity}
            </span>
          </div>
        ) : null}
        <ol className="ph-rows">
          {beat.rows.map((event, i) => (
            <Row key={event.id} event={event} order={i} shown={i < visible} latest={i === Math.min(visible, beat.rows.length) - 1} />
          ))}
        </ol>
      </>
    );
  } else if (status === "ready") {
    body = <p className="ph-empty">This step was not recorded in the latest verified run.</p>;
  } else if (status === "loading") {
    body = (
      <div className="ph-skeleton" role="status" aria-label="Loading the recorded run">
        <span />
        <span />
        <span />
      </div>
    );
  } else {
    body = <p className="ph-empty">{status === "empty" ? "No verified recovery is recorded yet." : "The recorded run couldn't be loaded."}</p>;
  }

  return (
    <div className="phone" data-beat={index}>
      <div className="phone-screen">
        <div className="ph-status" aria-hidden="true">
          <span>{time}</span>
          <span className="ph-island" />
          <span>UTC</span>
        </div>
        <div className="ph-bar">
          <Image src="/brand/nentra/nentra-mark.png" alt="" width={664} height={569} className="h-[18px] w-auto" sizes="24px" />
          <span className="ph-case">{order ? `Case ${order.orderNumber}` : "Recorded case"}</span>
          <span className="ph-chip">{snapshot?.merchant.mode ?? "DEMO_SANDBOX"}</span>
        </div>
        <div className="ph-body">{body}</div>
        <div className="ph-foot" aria-hidden={!anchor}>
          {anchor && total ? (
            <>
              <span>
                Event {anchor.seq} of {total}
              </span>
              <span className="ph-progress">
                <span style={{ transform: `scaleX(${anchor.seq / total})` }} />
              </span>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
