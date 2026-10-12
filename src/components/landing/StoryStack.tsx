"use client";

import {
  Check,
  MessageCircle,
  MessageSquare,
  Package,
  Phone,
  Route,
  Search,
  ShieldCheck,
  Table2,
  Truck,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  CINEMATIC_QUERY,
  type ScrollTriggerInstance,
  loadScrollTrigger,
  scheduleRefresh,
  useMediaQuery,
} from "./scroll-motion";

import "./story.css";

const Accent = ({ children }: { children: React.ReactNode }) => <span className="serif-accent">{children}</span>;

/* ---------- Illustrative cards. None of these show recorded data. ---------- */

const TOOLS = [
  { id: "chat", label: "Chat threads", Icon: MessageCircle },
  { id: "courier", label: "Courier portal", Icon: Truck },
  { id: "sheet", label: "Spreadsheet", Icon: Table2 },
  { id: "phone", label: "Phone calls", Icon: Phone },
] as const;

const SCATTER = [
  { lit: ["chat", "phone", "sheet"], line: "Someone has to ask, wait for the answer, re-enter the address and try again." },
  { lit: ["courier", "sheet", "phone"], line: "Someone has to notice the failure, compare other options and decide on the cost." },
  { lit: ["chat", "phone"], line: "Someone has to chase one answer across several conversations." },
];

function ScatterCard({ active }: { active: number }) {
  const state = SCATTER[active];
  return (
    <div className="card-scatter">
      <div className="scatter-map">
        <svg viewBox="0 0 300 220" aria-hidden="true" className="scatter-lines">
          {[
            [70, 50],
            [230, 50],
            [70, 170],
            [230, 170],
          ].map(([x, y], i) => (
            <line key={i} x1="150" y1="110" x2={x} y2={y} data-lit={state.lit.includes(TOOLS[i].id as never)} />
          ))}
        </svg>
        <span className="scatter-core">The order</span>
        {TOOLS.map(({ id, label, Icon }, i) => (
          <span key={id} className={`scatter-node n${i}`} data-lit={state.lit.includes(id as never)}>
            <Icon aria-hidden="true" size={16} />
            {label}
          </span>
        ))}
      </div>
      <p className="card-line">{state.line}</p>
    </div>
  );
}

const ROLES = [
  { name: "Investigator", Icon: Search, color: "#F5B561", line: "Checks the order context and names exactly what is missing or blocked." },
  { name: "Customer Liaison", Icon: MessageSquare, color: "#E3C07F", line: "Prepares a scoped request for the one detail the customer needs to give." },
  { name: "Fulfillment", Icon: Package, color: "#B5440F", line: "Requests shipping quotes and writes a single booking within approved limits." },
  { name: "Recovery", Icon: Route, color: "#F28A2E", line: "Classifies a failure and selects an eligible alternative instead of stopping." },
  { name: "Verifier", Icon: ShieldCheck, color: "#F6EEDC", line: "Reads the outcome back independently before anything is called resolved." },
];

function TeamCard({ active }: { active: number }) {
  const role = ROLES[active];
  return (
    <div className="card-team">
      <span className="team-glyph" style={{ "--c": role.color } as React.CSSProperties}>
        <role.Icon aria-hidden="true" size={30} strokeWidth={1.8} />
      </span>
      <p className="team-from">Controller hands off to</p>
      <p className="team-name">{role.name}</p>
      <p className="card-line">{role.line}</p>
      <ol className="team-chain" aria-hidden="true">
        {ROLES.map((r, i) => (
          <li key={r.name} data-state={i < active ? "done" : i === active ? "now" : "next"} />
        ))}
      </ol>
    </div>
  );
}

const ROUTE_LINES = [
  "The preferred route is unavailable. Nentra records why before deciding anything.",
  "Alternatives are checked against the rules you set. Ineligible ones are set aside.",
  "One eligible route becomes a proposal, with its cost and the reason beside it.",
];

function RouteCard({ active }: { active: number }) {
  return (
    <div className="card-route" data-step={active}>
      <div className="route-map">
        <svg viewBox="0 0 320 190" aria-hidden="true">
          <path className="r-preferred" d="M40 95 C 120 95, 140 36, 270 36" />
          <path className="r-alt r-alt-a" d="M40 95 C 140 95, 170 95, 270 95" />
          <path className="r-alt r-alt-b" d="M40 95 C 120 95, 140 154, 270 154" />
          <circle cx="40" cy="95" r="7" className="r-node" />
          <circle cx="270" cy="36" r="6" className="r-end r-end-p" />
          <circle cx="270" cy="95" r="6" className="r-end r-end-a" />
          <circle cx="270" cy="154" r="6" className="r-end r-end-b" />
          <g className="r-break" transform="translate(150 54)">
            <circle r="10" />
            <path d="M-4 -4 L4 4 M4 -4 L-4 4" />
          </g>
        </svg>
        <span className="r-label r-label-p">
          <X aria-hidden="true" size={12} strokeWidth={3} /> Preferred route unavailable
        </span>
        <span className="r-label r-label-a">Eligible alternative</span>
        <span className="r-label r-label-b">Over your rules</span>
      </div>
      <p className="card-line">{ROUTE_LINES[active]}</p>
    </div>
  );
}

const CONTROL_LINES = [
  "You set the limit for what Nentra may spend without asking.",
  "A proposal above that limit pauses. Nothing is booked while it waits.",
  "Your decision is recorded with the evidence that was in front of you.",
];

function ControlCard({ active }: { active: number }) {
  return (
    <div className="card-control" data-step={active}>
      <div className="ctl-track">
        <span className="ctl-cost" />
        <span className="ctl-ceiling">
          <span>Your ceiling</span>
        </span>
      </div>
      <div className="ctl-chips">
        <span className="ctl-chip is-wait">Paused for your approval</span>
        <span className="ctl-chip is-ok">
          <Check aria-hidden="true" size={13} strokeWidth={3} /> Approved by you, on record
        </span>
      </div>
      <p className="card-line">{CONTROL_LINES[active]}</p>
    </div>
  );
}

const PROOF_ROWS = ["Booking identity", "Order", "Courier", "Price", "Status"];
const PROOF_LINES = [
  "After a booking is written, a separate check reads it back from the provider.",
  "The readback is compared field by field with the intent that was approved.",
  "Only a match produces a passing receipt. A mismatch sends the case back to you.",
];

function ProofCard({ active }: { active: number }) {
  return (
    <div className="card-proof" data-step={active}>
      <div className="proof-cols">
        <div>
          <p className="proof-head">Approved intent</p>
          {PROOF_ROWS.map((r) => (
            <span key={r} className="proof-cell">
              {r}
            </span>
          ))}
        </div>
        <div className="proof-read">
          <p className="proof-head">Fresh readback</p>
          {PROOF_ROWS.map((r, i) => (
            <span key={r} className="proof-cell" style={{ "--d": `${i * 80}ms` } as React.CSSProperties}>
              <Check aria-hidden="true" size={12} strokeWidth={3} />
              {r}
            </span>
          ))}
        </div>
      </div>
      <span className="proof-seal">
        <ShieldCheck aria-hidden="true" size={16} /> PASS receipt saved
      </span>
      <p className="card-line">{PROOF_LINES[active]}</p>
    </div>
  );
}

type Scene = {
  id: string;
  eyebrow: string;
  title: React.ReactNode;
  body: string;
  pills: readonly string[];
  Card: (props: { active: number }) => React.ReactNode;
  caption: string;
};

const SCENES: Scene[] = [
  {
    id: "problem",
    eyebrow: "The problem",
    title: (
      <>
        An order can fail long before anyone calls it <Accent>cancelled.</Accent>
      </>
    ),
    body: "A missing landmark. A courier quote that never comes back. A customer who needs to confirm one detail. Small exceptions turn into hours of manual work when nobody owns the next step.",
    pills: ["Missing landmark", "Failed quote", "One detail to confirm"],
    Card: ScatterCard,
    caption: "Illustrative",
  },
  {
    id: "team",
    eyebrow: "The team",
    title: (
      <>
        Specialists work the case, <Accent>together.</Accent>
      </>
    ),
    body: "Nentra turns an exception into owned work. A Controller plans the steps and hands each one to the specialist who should do it, so the case keeps moving while it waits on people and systems.",
    pills: ROLES.map((r) => r.name),
    Card: TeamCard,
    caption: "Roles in Nentra",
  },
  {
    id: "failure",
    eyebrow: "When a tool fails",
    title: (
      <>
        The preferred route fails. The case <Accent>keeps going.</Accent>
      </>
    ),
    body: "Nentra checks approved alternatives after a courier quote or booking attempt fails. A failure becomes a decision instead of a dead end.",
    pills: ["Record the failure", "Check alternatives", "Propose the next move"],
    Card: RouteCard,
    caption: "Illustrative",
  },
  {
    id: "control",
    eyebrow: "Approvals",
    title: (
      <>
        Lighter work. Decisions stay <Accent>yours.</Accent>
      </>
    ),
    body: "Automation should make the work lighter, not the decisions invisible. When an action carries cost or risk, Nentra shows the evidence and waits for you.",
    pills: ["Your limit", "Pause before spend", "Decision on record"],
    Card: ControlCard,
    caption: "Illustrative",
  },
  {
    id: "proof",
    eyebrow: "Verification",
    title: (
      <>
        Verified, not <Accent>claimed.</Accent>
      </>
    ),
    body: "Before a case is called resolved, an independent check reads the outcome back and compares it with what was approved. If it doesn't match, the case comes back to you with its record.",
    pills: ["Fresh readback", "Compare to intent", "Receipt on record"],
    Card: ProofCard,
    caption: "Illustrative",
  },
];

/* ---------- Timeline maths: each scene holds for its pills, then the next slides over it. ---------- */

const HOLD = 2.4;
const UNIT_VH = 0.34;
const TOTAL = SCENES.length * HOLD + (SCENES.length - 1);

function locate(progress: number) {
  const t = Math.min(TOTAL - 0.0001, Math.max(0, progress * TOTAL));
  const k = Math.min(SCENES.length - 1, Math.floor(t / (HOLD + 1)));
  const r = t - k * (HOLD + 1);
  const n = SCENES[k].pills.length;
  if (r <= HOLD) return { scene: k, pill: Math.min(n - 1, Math.floor((r / HOLD) * n)) };
  return r > HOLD + 0.5 && k < SCENES.length - 1 ? { scene: k + 1, pill: 0 } : { scene: k, pill: n - 1 };
}

function positionOf(scene: number, pill: number) {
  const n = SCENES[scene].pills.length;
  return (scene * (HOLD + 1) + ((pill + 0.5) / n) * HOLD) / TOTAL;
}

function SceneView({
  scene,
  index,
  active,
  current,
  cinematic,
  onPill,
}: {
  scene: Scene;
  index: number;
  active: number;
  current: boolean;
  cinematic: boolean;
  onPill: (pill: number) => void;
}) {
  const { Card } = scene;
  return (
    <article
      className="scene"
      data-scene={scene.id}
      data-current={current}
      aria-labelledby={`scene-${scene.id}`}
      inert={cinematic && !current ? true : undefined}
    >
      <div className="container-n scene-grid" data-flip={index % 2 === 1}>
        <div className="scene-copy">
          <p className="eyebrow-pill">{scene.eyebrow}</p>
          <h3 id={`scene-${scene.id}`} className="h2 scene-title">
            {scene.title}
          </h3>
          <p className="lead scene-body">{scene.body}</p>
          <div className="scene-pills" role="group" aria-label={`${scene.eyebrow}: steps`}>
            {scene.pills.map((label, i) => (
              <button key={label} type="button" className="tag-pill" aria-pressed={i === active} onClick={() => onPill(i)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="scene-visual">
          <div className="tilt-card" data-current={current}>
            <span className="card-caption">{scene.caption}</span>
            <Card active={active} />
          </div>
        </div>
      </div>
    </article>
  );
}

function StaticScene({ scene, index }: { scene: Scene; index: number }) {
  const [pill, setPill] = useState(0);
  return <SceneView scene={scene} index={index} active={pill} current cinematic={false} onPill={setPill} />;
}

function CinematicStack() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<ScrollTriggerInstance | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let revert: (() => void) | undefined;
    loadScrollTrigger().then(({ gsap, ScrollTrigger }) => {
      const wrap = wrapRef.current;
      const stage = stageRef.current;
      if (cancelled || !wrap || !stage) return;
      const ctx = gsap.context(() => {
        const scenes = gsap.utils.toArray<HTMLElement>(".scene", stage);
        // Aperture: the stage opens from a vertical slit as it arrives, used once on the page.
        gsap.fromTo(
          stage,
          { "--ap": 0 },
          { "--ap": 50, ease: "none", scrollTrigger: { trigger: wrap, start: "top bottom", end: "top top", scrub: 0.6 } },
        );
        const tl = gsap.timeline({
          defaults: { ease: "none" },
          scrollTrigger: {
            trigger: wrap,
            start: "top top",
            end: () => `+=${window.innerHeight * UNIT_VH * TOTAL}`,
            pin: stage,
            scrub: 0.8,
            anticipatePin: 1,
            refreshPriority: 1,
            invalidateOnRefresh: true,
            onUpdate: (self) => setProgress(Math.round(self.progress * 600) / 600),
          },
        });
        triggerRef.current = tl.scrollTrigger ?? null;
        scenes.forEach((el, i) => {
          if (i > 0) {
            // y is reset explicitly so the CSS pre-JS offset is not parsed as an extra pixel shift.
            tl.fromTo(el, { yPercent: 100, y: 0 }, { yPercent: 0, y: 0, duration: 1 });
            tl.to(scenes[i - 1], { yPercent: -12, scale: 0.94, opacity: 0.2, duration: 1 }, "<");
          }
          tl.to({}, { duration: HOLD });
        });
      }, wrap);
      revert = () => ctx.revert();
      scheduleRefresh(ScrollTrigger);
    });
    return () => {
      cancelled = true;
      triggerRef.current = null;
      revert?.();
    };
  }, []);

  const { scene, pill } = locate(progress);

  const goTo = (s: number, p: number) => {
    const st = triggerRef.current;
    if (!st) return;
    window.scrollTo({ top: st.start + (st.end - st.start) * positionOf(s, p), behavior: "smooth" });
  };

  return (
    <div ref={wrapRef} className="story-pin">
      <div ref={stageRef} className="story-stage">
        <span className="story-lens" aria-hidden="true" />
        {SCENES.map((s, i) => (
          <SceneView
            key={s.id}
            scene={s}
            index={i}
            active={i === scene ? pill : i < scene ? s.pills.length - 1 : 0}
            current={i === scene}
            cinematic
            onPill={(p) => goTo(i, p)}
          />
        ))}
        <nav className="story-pager" aria-label="Story scenes">
          {SCENES.map((s, i) => (
            <button
              key={s.id}
              type="button"
              aria-label={s.eyebrow}
              aria-current={i === scene ? "step" : undefined}
              data-active={i === scene}
              onClick={() => goTo(i, 0)}
            />
          ))}
        </nav>
      </div>
    </div>
  );
}

export function StoryStack() {
  const cinematic = useMediaQuery(CINEMATIC_QUERY);
  return (
    <section id="why" className="story" data-mode={cinematic ? "cinematic" : "static"} aria-labelledby="story-heading">
      <h2 id="story-heading" className="sr-only">
        Why merchants need more than an alert
      </h2>
      {cinematic ? <CinematicStack /> : SCENES.map((s, i) => <StaticScene key={s.id} scene={s} index={i} />)}
    </section>
  );
}
