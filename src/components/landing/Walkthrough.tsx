"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { PhoneScreen } from "./PhoneScreen";
import { RecordedState, useRecordedCase } from "./recorded/RecordedCase";
import {
  CINEMATIC_QUERY,
  type ScrollTriggerInstance,
  loadScrollTrigger,
  scheduleRefresh,
  useInView,
  useMediaQuery,
} from "./scroll-motion";

import "./walkthrough.css";

/** Narrative copy for the five beats. The phone beside each one shows the persisted events. */
const STEPS = [
  {
    label: "Exception",
    title: "A paid order stops at a missing landmark.",
    body: "The order is paid and ready to leave Ikeja for Lekki, but a courier can't quote an address that has no landmark.",
  },
  {
    label: "Investigation",
    title: "The Investigator names the gap.",
    body: "Nentra checks the required delivery fields, finds the missing landmark and hands the case to the Customer Liaison to ask for it.",
  },
  {
    label: "Route failure",
    title: "The detail arrives. The preferred quote fails.",
    body: "The landmark comes back through a scoped form. Then the preferred shipping quote returns HTTP 503.",
  },
  {
    label: "Approval",
    title: "Recovery finds a route. You approve the cost.",
    body: "Recovery treats the 503 as transient and selects an eligible alternative. It costs more than the shipping ceiling, so it waits for the merchant.",
  },
  {
    label: "Verification",
    title: "One booking, read back and verified.",
    body: "Fulfillment writes a single sandbox booking. The Verifier reads it back independently and returns PASS. Delivery is not claimed.",
  },
] as const;

const BEATS = STEPS.length;
/** Scroll runway per beat, in viewport heights. */
const BEAT_VH = 0.9;

function range(beat: { events: { seq: number }[] } | undefined) {
  const list = beat?.events ?? [];
  if (!list.length) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return `Events #${p(list[0].seq)}–${p(list.at(-1)!.seq)}`;
}

function Copy({ i, active }: { i: number; active?: boolean }) {
  const { beats } = useRecordedCase();
  const step = STEPS[i];
  const events = range(beats[i]);
  return (
    <div className="wt-copy-item" data-active={active} aria-hidden={active === false}>
      <p className="numeral">
        {String(i + 1).padStart(2, "0")} <span className="sr-only">of {BEATS}:</span> {step.label}
      </p>
      <h3 className="wt-title">{step.title}</h3>
      <p className="wt-body">{step.body}</p>
      {events ? <p className="wt-events">{events}</p> : null}
    </div>
  );
}

function Cinematic() {
  const { beats } = useRecordedCase();
  const sectionRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const phoneRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<ScrollTriggerInstance | null>(null);
  const [pos, setPos] = useState(0);
  const inView = useInView(stageRef);

  useEffect(() => {
    let cancelled = false;
    let revert: (() => void) | undefined;
    loadScrollTrigger().then(({ gsap, ScrollTrigger }) => {
      if (cancelled || !sectionRef.current) return;
      const ctx = gsap.context(() => {
        const entry = { trigger: sectionRef.current, start: "top bottom", end: "top top", scrub: 0.8 };
        gsap.fromTo(phoneRef.current, { yPercent: 62 }, { yPercent: 0, ease: "none", scrollTrigger: entry });
        gsap.fromTo(glowRef.current, { opacity: 0.35, scaleY: 0.7 }, { opacity: 1, scaleY: 1, ease: "none", scrollTrigger: entry });
        triggerRef.current = ScrollTrigger.create({
          trigger: sectionRef.current,
          start: "top top",
          end: () => `+=${window.innerHeight * BEAT_VH * BEATS}`,
          pin: stageRef.current,
          anticipatePin: 1,
          refreshPriority: 2,
          invalidateOnRefresh: true,
          onUpdate: (self) => setPos(Math.round(self.progress * 500) / 500),
        });
      }, sectionRef);
      revert = () => ctx.revert();
      scheduleRefresh(ScrollTrigger);
    });
    return () => {
      cancelled = true;
      triggerRef.current = null;
      revert?.();
    };
  }, []);

  // Heights below the pin change once the recorded run arrives.
  useEffect(() => {
    if (beats.length) loadScrollTrigger().then(({ ScrollTrigger }) => scheduleRefresh(ScrollTrigger));
  }, [beats.length]);

  const scaled = pos * BEATS;
  const active = Math.min(BEATS - 1, Math.floor(scaled));
  const within = Math.min(1, scaled - active);
  const rows = beats[active]?.rows.length ?? 0;
  const visible = Math.max(1, Math.ceil(within * (rows + 0.6)));

  const goTo = (i: number) => {
    const st = triggerRef.current;
    if (!st) return;
    window.scrollTo({ top: st.start + ((st.end - st.start) * (i + 0.4)) / BEATS, behavior: "smooth" });
  };

  return (
    <div ref={sectionRef} className="wt-pin">
      <div ref={stageRef} className="wt-stage" data-inview={inView}>
        <div className="wt-dust" aria-hidden="true" />
        <div ref={glowRef} className="wt-horizon" aria-hidden="true">
          <span />
        </div>
        <div className="wt-grid container-n">
          <div className="wt-copy">
            <p className="micro-label wt-kicker">Recorded sandbox recovery</p>
            <div className="wt-copy-stack" aria-live="polite">
              {STEPS.map((_, i) => (
                <Copy key={i} i={i} active={i === active} />
              ))}
            </div>
            <div className="wt-actions">
              <Link href="/app" className="btn btn-primary">
                Watch the full recovery
                <ArrowRight aria-hidden="true" size={18} />
              </Link>
              <RecordedState compact />
            </div>
          </div>

          <div className="wt-phone" ref={phoneRef}>
            <div className="wt-screens">
              {STEPS.map((_, i) => (
                <div key={i} className="wt-screen" data-active={i === active} aria-hidden={i !== active}>
                  <PhoneScreen beat={beats[i]} index={i} visible={i === active ? visible : i < active ? Infinity : 0} />
                </div>
              ))}
            </div>
          </div>

          <nav className="wt-index" aria-label="Recovery steps">
            <ol>
              {STEPS.map((step, i) => (
                <li key={step.label}>
                  <button type="button" data-active={i === active} aria-current={i === active ? "step" : undefined} onClick={() => goTo(i)}>
                    <span className="numeral">{String(i + 1).padStart(2, "0")}</span>
                    {step.label}
                  </button>
                </li>
              ))}
            </ol>
          </nav>
        </div>
      </div>
    </div>
  );
}

function Stacked() {
  const { beats } = useRecordedCase();
  return (
    <div className="wt-stacked container-n">
      <p className="micro-label wt-kicker">Recorded sandbox recovery</p>
      <RecordedState />
      <ol className="wt-list">
        {STEPS.map((step, i) => (
          <li key={step.label} className="wt-step">
            <Copy i={i} />
            <PhoneScreen beat={beats[i]} index={i} />
          </li>
        ))}
      </ol>
      <Link href="/app" className="btn btn-primary mt-12">
        Watch the full recovery
        <ArrowRight aria-hidden="true" size={18} />
      </Link>
    </div>
  );
}

export function Walkthrough() {
  const cinematic = useMediaQuery(CINEMATIC_QUERY);
  return (
    <section id="how-it-works" className="wt" aria-labelledby="wt-heading">
      <h2 id="wt-heading" className="sr-only">
        How Nentra worked a recorded order exception, step by step
      </h2>
      {cinematic ? <Cinematic /> : <Stacked />}
    </section>
  );
}
