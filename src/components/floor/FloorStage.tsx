"use client";

import { useEffect, useRef } from "react";

import type { FloorProjection, Party, StationStatus } from "./projection";
import { STATION_NAMES, STATIONS, type StationId } from "./types";

type Pt = readonly [number, number];

const POS: Record<Party, Pt> = {
  controller: [600, 372],
  investigator: [376, 270],
  verifier: [824, 270],
  liaison: [250, 430],
  recovery: [950, 430],
  fulfillment: [600, 574],
  customer: [104, 600],
  merchant: [1096, 600],
};

const ACCENT: Record<StationId, { body: string; trim: string }> = {
  controller: { body: "#F28A2E", trim: "#0D0B07" },
  investigator: { body: "#F5B561", trim: "#0D0B07" },
  liaison: { body: "#E3C07F", trim: "#0D0B07" },
  fulfillment: { body: "#B5440F", trim: "#F6EEDC" },
  recovery: { body: "#7A2A0E", trim: "#F5B561" },
  verifier: { body: "#F6EEDC", trim: "#0D0B07" },
};

const STATUS_TEXT: Record<StationStatus, string> = {
  idle: "Idle",
  assigned: "Task assigned",
  working: "Working",
  done: "Step complete",
  waiting: "Waiting",
  failed: "Failed",
  passed: "Verified PASS",
  escalated: "Escalated",
};

const EX = [0.866, 0.5] as const;
const EY = [-0.866, 0.5] as const;

const pts = (list: Pt[]) => list.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
const add = (p: Pt, a: number, b: number, up = 0): Pt => [p[0] + a * EX[0] + b * EY[0], p[1] + a * EX[1] + b * EY[1] - up];

/** An isometric box whose top face is centered on (cx, cy). */
function Box({ c, a, b, h, top, left, right, className }: { c: Pt; a: number; b: number; h: number; top: string; left: string; right: string; className?: string }) {
  const o: Pt = [c[0] - (a - b) * 0.433, c[1] - (a + b) * 0.25 + h];
  const b1 = add(o, a, 0);
  const b2 = add(o, a, b);
  const b3 = add(o, 0, b);
  const up = (p: Pt): Pt => [p[0], p[1] - h];
  return (
    <g className={className}>
      <polygon points={pts([b3, b2, up(b2), up(b3)])} fill={left} />
      <polygon points={pts([b1, b2, up(b2), up(b1)])} fill={right} />
      <polygon points={pts([up(o), up(b1), up(b2), up(b3)])} fill={top} />
    </g>
  );
}

function diamond(c: Pt, hw: number, hh: number) {
  return pts([
    [c[0], c[1] - hh],
    [c[0] + hw, c[1]],
    [c[0], c[1] + hh],
    [c[0] - hw, c[1]],
  ]);
}

function Agent({ id, status, receiving, lean }: { id: StationId; status: StationStatus; receiving: boolean; lean: Pt }) {
  const { body, trim } = ACCENT[id];
  const [cx, cy] = POS[id];
  const spot: Pt =
    status === "working" || status === "failed"
      ? [cx - 8, cy - 6]
      : status === "waiting" || status === "passed" || status === "escalated"
        ? [cx - 22, cy + 18]
        : [cx - 46, cy + 8];
  const x = spot[0] + lean[0];
  const y = spot[1] + lean[1];
  return (
    <g className="agent-pos" style={{ transform: `translate(${x}px, ${y}px) scale(1.3)` }}>
      <g className={`agent is-${status}${receiving ? " is-receiving" : ""}`}>
        <ellipse cx={0} cy={0} rx={15} ry={5.5} className="agent-shadow" />
        <g className="agent-body">
          <rect x={-10} y={-36} width={20} height={30} rx={10} fill={body} />
          <rect x={-10} y={-22} width={20} height={4} fill={trim} opacity={0.35} />
          <circle cx={0} cy={-45} r={9.5} fill="#F6EEDC" />
          <rect x={-6.5} y={-48} width={13} height={4.5} rx={2.25} fill="#0D0B07" opacity={0.85} />
          <Accessory id={id} trim={trim} body={body} />
        </g>
      </g>
    </g>
  );
}

function Accessory({ id, trim, body }: { id: StationId; trim: string; body: string }) {
  switch (id) {
    case "controller":
      return (
        <g>
          <path d="M -10 -47 A 10 10 0 0 1 10 -47" fill="none" stroke="#0D0B07" strokeWidth={2.4} />
          <line x1={0} y1={-55} x2={0} y2={-64} stroke="#0D0B07" strokeWidth={2} />
          <circle cx={0} cy={-66} r={3} fill={body} className="antenna" />
        </g>
      );
    case "investigator":
      return (
        <g>
          <circle cx={13} cy={-26} r={6} fill="none" stroke="#0D0B07" strokeWidth={2.4} />
          <line x1={17} y1={-21} x2={22} y2={-15} stroke="#0D0B07" strokeWidth={2.6} strokeLinecap="round" />
        </g>
      );
    case "liaison":
      return (
        <g>
          <path d="M -10 -45 A 10 10 0 0 1 10 -45" fill="none" stroke="#0D0B07" strokeWidth={2.2} />
          <path d="M 10 -44 Q 12 -36 5 -35" fill="none" stroke="#0D0B07" strokeWidth={1.8} />
          <circle cx={4.5} cy={-35} r={1.8} fill="#0D0B07" />
        </g>
      );
    case "fulfillment":
      return (
        <g>
          <path d="M -10 -50 Q 0 -60 10 -50 Z" fill={body} stroke={trim} strokeWidth={1.2} />
          <rect x={-2} y={-51} width={16} height={3} rx={1.5} fill={trim} />
        </g>
      );
    case "recovery":
      return (
        <g>
          <path d="M -11 -48 Q 0 -63 11 -48 Z" fill="#F5B561" />
          <rect x={-12} y={-49} width={24} height={3} rx={1.5} fill="#F5B561" />
          <path d="M -10 -14 L 10 -14" stroke={trim} strokeWidth={3} strokeLinecap="round" />
        </g>
      );
    case "verifier":
      return (
        <g>
          <rect x={-9} y={-49} width={18} height={6} rx={3} fill="#0D0B07" />
          <rect x={-6} y={-47.5} width={12} height={2.5} rx={1.25} fill="#F5B561" className="visor" />
        </g>
      );
  }
}

/** Role-specific station furniture. States only come from the projected event status. */
function Props({ id, status, code }: { id: StationId; status: StationStatus; code: string | null }) {
  const [cx, cy] = POS[id];
  const desk = { top: "#2E2418", left: "#211A11", right: "#17120C" };
  const lit = status === "working" || status === "assigned";
  switch (id) {
    case "controller":
      return (
        <g>
          <ellipse cx={cx + 22} cy={cy - 6} rx={40} ry={20} fill="#2E2418" />
          <path d={`M ${cx - 18} ${cy - 6} v 10 a 40 20 0 0 0 80 0 v -10`} fill="#17120C" />
          <ellipse cx={cx + 22} cy={cy - 6} rx={40} ry={20} fill="#2E2418" />
          <ellipse cx={cx + 22} cy={cy - 8} rx={28} ry={13} className={`holo${lit ? " is-on" : ""}`} />
          <ellipse cx={cx + 22} cy={cy - 8} rx={14} ry={6.5} className={`holo holo-inner${lit ? " is-on" : ""}`} />
        </g>
      );
    case "investigator":
      return (
        <g>
          <Box c={[cx + 26, cy - 12]} a={58} b={34} h={18} {...desk} />
          <polygon points={pts([[cx + 10, cy - 32], [cx + 32, cy - 21], [cx + 46, cy - 29], [cx + 24, cy - 40]])} fill="#F6EEDC" opacity={0.9} />
          <line x1={cx + 18} y1={cy - 32} x2={cx + 34} y2={cy - 24} stroke="#0D0B07" strokeWidth={1.5} opacity={0.5} />
          <line x1={cx + 22} y1={cy - 35} x2={cx + 38} y2={cy - 27} stroke={status === "done" ? "#F28A2E" : "#0D0B07"} strokeWidth={1.5} opacity={0.6} />
          <circle cx={cx + 30} cy={cy - 30} r={7} className={`lens${lit ? " is-on" : ""}`} />
        </g>
      );
    case "liaison":
      return (
        <g>
          <Box c={[cx + 24, cy - 10]} a={50} b={32} h={18} {...desk} />
          <Box c={[cx + 30, cy - 34]} a={30} b={6} h={22} top="#1B160F" left="#0D0B07" right="#0D0B07" />
          <g className={`envelope${status === "waiting" ? " is-waiting" : ""}${status === "done" ? " is-done" : ""}`}>
            <rect x={cx + 18} y={cy - 56} width={22} height={14} rx={2} />
            <path d={`M ${cx + 18} ${cy - 56} l 11 8 l 11 -8`} fill="none" strokeWidth={1.4} />
          </g>
        </g>
      );
    case "fulfillment": {
      const failed = status === "failed";
      return (
        <g>
          <Box c={[cx + 6, cy - 20]} a={50} b={30} h={16} {...desk} />
          <Box c={[cx + 58, cy + 6]} a={24} b={24} h={18} top="#C98A4B" left="#9C6534" right="#7E4F27" />
          <Box c={[cx + 58, cy - 12]} a={20} b={20} h={14} top="#D39A5C" left="#A86F3B" right="#86552B" />
          <g className={`board${failed ? " is-failed" : ""}${lit ? " is-on" : ""}`}>
            <rect x={cx + 16} y={cy - 74} width={92} height={30} rx={4} />
            <text x={cx + 62} y={cy - 54} textAnchor="middle" className="board-text">
              {failed ? (code ?? "FAILED") : code ?? "QUOTES"}
            </text>
          </g>
        </g>
      );
    }
    case "recovery": {
      const chosen = status === "done" || status === "working";
      return (
        <g>
          <Box c={[cx + 24, cy - 8]} a={54} b={30} h={14} {...desk} />
          <path d={`M ${cx - 6} ${cy - 22} L ${cx + 18} ${cy - 22}`} className="route route-main" />
          <path d={`M ${cx + 18} ${cy - 22} L ${cx + 44} ${cy - 36}`} className="route route-dead" />
          <path d={`M ${cx + 18} ${cy - 22} L ${cx + 48} ${cy - 16}`} className={`route route-alt${chosen ? " is-on" : ""}`} />
          <circle cx={cx + 18} cy={cy - 22} r={4} fill="#F5B561" />
        </g>
      );
    }
    case "verifier": {
      const passed = status === "passed";
      const failed = status === "failed";
      return (
        <g>
          <path
            d={`M ${cx + 2} ${cy - 2} v -46 a 24 14 0 0 1 48 0 v 46`}
            fill="none"
            className={`gate${lit ? " is-on" : ""}${passed ? " is-passed" : ""}${failed ? " is-failed" : ""}`}
          />
          <line x1={cx + 2} y1={cy - 30} x2={cx + 50} y2={cy - 30} className={`scan${lit ? " is-on" : ""}`} />
          {passed ? (
            <g className="seal">
              <circle cx={cx + 26} cy={cy - 66} r={13} />
              <path d={`M ${cx + 20} ${cy - 66} l 4 4 l 8 -8`} fill="none" strokeWidth={2.4} strokeLinecap="round" />
            </g>
          ) : null}
        </g>
      );
    }
  }
}

function Token({ from, to, seq, reduce }: { from: Party; to: StationId; seq: number; reduce: boolean }) {
  const ref = useRef<SVGGElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const a = POS[from];
    const b = POS[to];
    const lift = Math.min(120, Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.35);
    const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - lift];
    if (reduce) {
      el.style.transform = `translate(${b[0]}px, ${b[1] - 70}px)`;
      return;
    }
    const frames: Keyframe[] = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const x = (1 - t) * (1 - t) * a[0] + 2 * (1 - t) * t * mid[0] + t * t * b[0];
      const y = (1 - t) * (1 - t) * (a[1] - 60) + 2 * (1 - t) * t * mid[1] + t * t * (b[1] - 70);
      frames.push({ transform: `translate(${x}px, ${y}px)`, opacity: t > 0.9 ? 1 - (t - 0.9) * 6 : 1 });
    }
    const animation = el.animate(frames, { duration: 950, easing: "cubic-bezier(.45,0,.2,1)", fill: "forwards" });
    return () => animation.cancel();
  }, [from, to, seq, reduce]);
  return (
    <g ref={ref} className="token" aria-hidden="true">
      <rect x={-13} y={-9} width={26} height={18} rx={4} />
      <path d="M -7 -2 h 14 M -7 3 h 9" />
    </g>
  );
}

export function FloorStage({ view, reduce }: { view: FloorProjection; reduce: boolean }) {
  const { stations, handoff, focus } = view;
  const resolved = view.outcome?.type === "CASE_RESOLVED";

  const leanFor = (id: StationId): Pt => {
    if (!handoff || handoff.from !== id) return [0, 0];
    const a = POS[id];
    const b = POS[handoff.to];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [((b[0] - a[0]) / len) * 16, ((b[1] - a[1]) / len) * 16];
  };

  return (
    <svg
      className={`floor-svg${resolved ? " is-resolved" : ""}`}
      viewBox="40 60 1120 650"
      role="img"
      aria-label={`Operations floor. ${STATIONS.map((id) => `${STATION_NAMES[id]}: ${STATUS_TEXT[stations[id].status]}`).join(". ")}.`}
    >
      <defs>
        <linearGradient id="wall-l" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#0D0B07" />
          <stop offset="1" stopColor="#1E170F" />
        </linearGradient>
        <linearGradient id="wall-r" x1="1" y1="0" x2="0" y2="0">
          <stop offset="0" stopColor="#0D0B07" />
          <stop offset="1" stopColor="#1A140D" />
        </linearGradient>
        <radialGradient id="floor-glow" cx="0.5" cy="0.55" r="0.6">
          <stop offset="0" stopColor="#3A2410" />
          <stop offset="0.6" stopColor="#1A130C" />
          <stop offset="1" stopColor="#110D08" />
        </radialGradient>
        <linearGradient id="beam" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="rgba(255,236,200,0.16)" />
          <stop offset="1" stopColor="rgba(255,236,200,0)" />
        </linearGradient>
      </defs>

      {/* room shell */}
      <polygon points={pts([[80, 400], [600, 100], [600, 0], [80, 300]])} fill="url(#wall-l)" />
      <polygon points={pts([[1120, 400], [600, 100], [600, 0], [1120, 300]])} fill="url(#wall-r)" />
      <polyline points={pts([[80, 300], [600, 0], [1120, 300]])} className="wall-edge" />
      <polygon points={pts([[300, 273], [600, 100], [600, 30], [300, 203]])} fill="url(#beam)" opacity={0.5} />
      <polygon points={pts([[900, 273], [600, 100], [600, 30], [900, 203]])} fill="url(#beam)" opacity={0.35} />
      <polygon points={diamond([600, 400], 520, 300)} fill="url(#floor-glow)" />
      <g className="floor-grid">
        {Array.from({ length: 11 }, (_, i) => {
          const t = (i + 1) / 12;
          return (
            <g key={i}>
              <line x1={80 + 520 * t} y1={400 - 300 * t} x2={600 + 520 * t} y2={700 - 300 * t} />
              <line x1={1120 - 520 * t} y1={400 - 300 * t} x2={600 - 520 * t} y2={700 - 300 * t} />
            </g>
          );
        })}
      </g>
      <polygon points={diamond([600, 400], 520, 300)} className="floor-edge" />

      {/* routes: spokes from the controller and the recovery path around it */}
      {STATIONS.filter((id) => id !== "controller").map((id) => (
        <line
          key={`sp-${id}`}
          x1={POS.controller[0]}
          y1={POS.controller[1]}
          x2={POS[id][0]}
          y2={POS[id][1]}
          className={`spoke${handoff && (handoff.to === id || handoff.from === id) ? " is-hot" : ""}`}
        />
      ))}
      <path
        d={`M ${POS.investigator.join(" ")} Q 260 330 ${POS.liaison.join(" ")} Q 380 560 ${POS.fulfillment.join(" ")} Q 830 560 ${POS.recovery.join(" ")} Q 940 330 ${POS.verifier.join(" ")}`}
        className="flow-path"
      />

      {/* external parties: they act on the case but are not agents */}
      {(["customer", "merchant"] as const).map((party) => (
        <g key={party} className={`party${handoff?.from === party ? " is-hot" : ""}`}>
          <Box c={POS[party]} a={30} b={30} h={44} top="#2A2016" left="#1E170F" right="#140F0A" />
          <text x={POS[party][0]} y={POS[party][1] + 40} textAnchor="middle" className="party-label">
            {party === "customer" ? "Customer" : "Merchant"}
          </text>
        </g>
      ))}

      {/* stations, back to front */}
      {[...STATIONS]
        .sort((a, b) => POS[a][1] - POS[b][1])
        .map((id) => {
          const s = stations[id];
          const [cx, cy] = POS[id];
          return (
            <g key={id} className={`station is-${s.status}${focus === id ? " is-focus" : ""}`}>
              <polygon points={diamond([cx, cy + 6], 116, 67)} className="station-ring" />
              <Box c={[cx, cy]} a={112} b={112} h={14} top="#231B12" left="#19130D" right="#110D08" className="platform" />
              <polygon points={diamond([cx, cy], 97, 56)} className="platform-tint" />
              <Props id={id} status={s.status} code={s.resultCode} />
              <Agent
                key={`${id}-${handoff?.to === id ? handoff.seq : "r"}`}
                id={id}
                status={s.status}
                receiving={handoff?.to === id}
                lean={leanFor(id)}
              />
              <text x={cx} y={cy + 92} textAnchor="middle" className="station-name">
                {STATION_NAMES[id]}
              </text>
              <text x={cx} y={cy + 112} textAnchor="middle" className="station-status">
                {s.status === "failed" && s.resultCode ? `Failed · ${s.resultCode}` : STATUS_TEXT[s.status]}
              </text>
            </g>
          );
        })}

      {handoff ? <Token key={handoff.seq} from={handoff.from} to={handoff.to} seq={handoff.seq} reduce={reduce} /> : null}
    </svg>
  );
}
