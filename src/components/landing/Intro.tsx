"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

import { INTRO_STORAGE_KEY, revealHero, useIntroState } from "./intro-state";

const LINE = "There is always a next move.".split(" ");
const NATURAL_REVEAL_MS = 3600;

const BOKEH = [
  { left: "6%", top: "56%", size: "30vw", o: 0.6, dur: "9.6s", dx: "2vw" },
  { left: "26%", top: "34%", size: "18vw", o: 0.4, dur: "14.4s", dx: "-1.5vw" },
  { left: "54%", top: "62%", size: "22vw", o: 0.5, dur: "12s", dx: "1.8vw" },
  { left: "80%", top: "50%", size: "28vw", o: 0.55, dur: "10.8s", dx: "-2vw" },
  { left: "36%", top: "86%", size: "34vw", o: 0.35, dur: "16.8s", dx: "1.2vw" },
  { left: "94%", top: "84%", size: "16vw", o: 0.45, dur: "13.2s", dx: "-1vw" },
];

const BEAMS = [
  { left: "20%", height: "34vh", delay: "0.25s", head: 18 },
  { left: "78%", height: "26vh", delay: "0.5s", head: 34 },
];

export function Intro() {
  const state = useIntroState();
  const [finished, setFinished] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const revealed = useRef(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  const complete = useCallback(() => {
    if (revealed.current) return;
    revealed.current = true;
    revealHero();
  }, []);

  const skip = useCallback(() => {
    complete();
    setLeaving(true);
  }, [complete]);

  const playing = state === "play";

  useEffect(() => {
    if (!playing) return;
    try {
      localStorage.setItem(INTRO_STORAGE_KEY, String(Date.now()));
    } catch {}

    // Sync the hand-off to the CSS timeline, which can start before hydration.
    const fade = overlayRef.current
      ?.getAnimations()
      .find((animation) => (animation as CSSAnimation).animationName === "intro-out");
    const elapsed = Number(fade?.currentTime ?? 0);
    const timer = window.setTimeout(complete, Math.max(0, NATURAL_REVEAL_MS - elapsed));
    const onKey = (event: KeyboardEvent) => {
      if (!["Shift", "Control", "Alt", "Meta"].includes(event.key)) skip();
    };
    const options: AddEventListenerOptions = { passive: true, once: true };
    window.addEventListener("keydown", onKey);
    window.addEventListener("wheel", skip, options);
    window.addEventListener("touchstart", skip, options);
    window.addEventListener("pointerdown", skip, options);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("wheel", skip);
      window.removeEventListener("touchstart", skip);
      window.removeEventListener("pointerdown", skip);
    };
  }, [playing, complete, skip]);

  if (state === "skip" || finished) return null;

  return (
    <>
      <div
        ref={overlayRef}
        className={`intro grain${leaving ? " is-leaving" : ""}`}
        aria-hidden="true"
        onAnimationEnd={(event) => {
          if (
            event.target === event.currentTarget &&
            (event.animationName === "intro-out" || event.animationName === "intro-leave")
          ) {
            complete();
            setFinished(true);
          }
        }}
      >
        <div className="intro-glow" />
        {BOKEH.map((b, i) => (
          <span
            key={i}
            className="bokeh"
            style={
              {
                left: b.left,
                top: b.top,
                width: b.size,
                height: b.size,
                minWidth: 180,
                minHeight: 180,
                marginLeft: `calc(${b.size} / -2)`,
                marginTop: `calc(${b.size} / -2)`,
                animationDelay: `${0.1 + i * 0.12}s, 0s`,
                animationDuration: `1200ms, ${b.dur}`,
                "--o": b.o,
                "--dx": b.dx,
              } as React.CSSProperties
            }
          />
        ))}
        {BEAMS.map((beam, i) => (
          <span
            key={i}
            className="beam"
            style={{ left: beam.left, height: beam.height, animationDelay: beam.delay }}
          >
            <span className="beam-head" style={{ width: beam.head, height: beam.head }} />
          </span>
        ))}
        <div className="intro-stage">
          <div className="orb-slot">
            <span className="orb-thread" />
            <span className="streak" />
            <span className="orb-halo" />
            <span className="orb" />
            <span className="intro-mark">
              <Image src="/brand/nentra/nentra-mark.png" alt="" width={664} height={569} preload />
            </span>
          </div>
          <p className="intro-line">
            {LINE.map((word, i) => (
              <span key={i} className="w" style={{ "--i": i } as React.CSSProperties}>
                {word}
                {i < LINE.length - 1 ? "\u00a0" : ""}
              </span>
            ))}
          </p>
        </div>
      </div>
      <button
        type="button"
        className={`intro-skip btn btn-outline btn-sm${leaving ? " is-leaving" : ""}`}
        onClick={skip}
        onPointerDown={(event) => event.stopPropagation()}
      >
        Skip intro
      </button>
    </>
  );
}
