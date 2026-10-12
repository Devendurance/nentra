"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { REVEAL_EVENT, useIntroState } from "./intro-state";

const SRC = "/brand/nentra/nentra-lockup.png";
const W = 1225;
const H = 267;
const WAVE_MS = 1100;

type Mode = "idle" | "wave" | "hover";

function setMask(el: HTMLElement | SVGElement, value: string) {
  el.style.setProperty("mask-image", value);
  el.style.setProperty("-webkit-mask-image", value);
}

/**
 * The official lockup with a controlled melt and reform, adapted from reference C.
 * A clean copy is always present. A filtered copy is revealed through a mask only
 * while the effect runs, so legibility returns as soon as the mask closes.
 */
export function MeltLockup() {
  const boxRef = useRef<HTMLDivElement>(null);
  const cleanRef = useRef<HTMLImageElement>(null);
  const fxRef = useRef<SVGSVGElement>(null);
  const turbRef = useRef<SVGFETurbulenceElement>(null);
  const dispRef = useRef<SVGFEDisplacementMapElement>(null);
  const holesRef = useRef<SVGFEColorMatrixElement>(null);
  const intro = useIntroState("skip");
  const [fxRequested, setFxMounted] = useState(false);
  // First visits preload the filtered copy during the intro so the hand-off wave is ready.
  const fxMounted = fxRequested || intro !== "skip";
  const fxReady = useRef(false);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let mode: Mode = "idle";
    let raf = 0;
    let waveStart = 0;
    let energy = 0;
    let radius = 0;
    let px = 0;
    let py = 0;
    let lastX = 0;
    let lastY = 0;
    let inside = false;
    let pendingWave = false;

    const applyIntensity = (k: number, t: number) => {
      dispRef.current?.setAttribute("scale", (k * 70).toFixed(2));
      holesRef.current?.setAttribute(
        "values",
        `0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -4 ${(6 - 4.4 * k).toFixed(3)}`,
      );
      turbRef.current?.setAttribute(
        "baseFrequency",
        `${(0.0055 + 0.0012 * Math.sin(t / 650)).toFixed(5)} ${(0.02 + 0.004 * Math.cos(t / 820)).toFixed(5)}`,
      );
    };

    const reset = () => {
      const clean = cleanRef.current;
      const fx = fxRef.current;
      if (clean) setMask(clean, "none");
      if (fx) {
        fx.style.opacity = "0";
        setMask(fx, "none");
      }
      applyIntensity(0, 0);
      mode = "idle";
      raf = 0;
    };

    const frame = (t: number) => {
      const clean = cleanRef.current;
      const fx = fxRef.current;
      if (!clean || !fx) return reset();

      if (mode === "wave") {
        const p = Math.min(1, (t - waveStart) / WAVE_MS);
        const eased = 1 - Math.pow(1 - p, 3);
        const front = -12 + eased * 124;
        fx.style.opacity = "1";
        setMask(fx, `linear-gradient(90deg, transparent ${front - 2}%, #000 ${front + 2}%)`);
        setMask(clean, `linear-gradient(90deg, #000 ${front - 2}%, transparent ${front + 2}%)`);
        applyIntensity(1 - eased * 0.5, t);
        if (p >= 1) return reset();
      } else if (mode === "hover") {
        energy *= 0.93;
        const scale = box.clientWidth / 880;
        const target = inside ? Math.min(1, energy) * 210 * scale : 0;
        radius += (target - radius) * 0.2;
        if (radius < 0.5 && energy < 0.01) return reset();
        const k = Math.min(1, radius / (150 * scale));
        fx.style.opacity = "1";
        setMask(fx, `radial-gradient(circle ${radius}px at ${px}px ${py}px, #000 62%, transparent 74%)`);
        setMask(clean, `radial-gradient(circle ${radius}px at ${px}px ${py}px, transparent 62%, #000 74%)`);
        applyIntensity(k, t);
      }
      raf = requestAnimationFrame(frame);
    };

    const start = () => {
      if (!raf) raf = requestAnimationFrame(frame);
    };

    const runWave = () => {
      if (!fxReady.current) {
        pendingWave = true;
        setFxMounted(true);
        return;
      }
      mode = "wave";
      waveStart = performance.now();
      start();
    };

    const onReady = () => {
      if (pendingWave) {
        pendingWave = false;
        runWave();
      }
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || mode === "wave") return;
      const rect = box.getBoundingClientRect();
      const margin = 48;
      inside =
        event.clientX > rect.left - margin &&
        event.clientX < rect.right + margin &&
        event.clientY > rect.top - margin &&
        event.clientY < rect.bottom + margin;
      if (!inside) return;
      if (!fxReady.current) {
        setFxMounted(true);
        return;
      }
      px = event.clientX - rect.left;
      py = event.clientY - rect.top;
      const travelled = Math.hypot(event.clientX - lastX, event.clientY - lastY);
      lastX = event.clientX;
      lastY = event.clientY;
      energy = Math.min(1.4, energy + travelled / 140);
      mode = "hover";
      start();
    };

    const onLeave = () => {
      inside = false;
    };

    box.addEventListener("nentra:fx-ready", onReady);
    window.addEventListener(REVEAL_EVENT, runWave);
    const canHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    if (canHover) {
      window.addEventListener("pointermove", onMove, { passive: true });
      document.documentElement.addEventListener("pointerleave", onLeave);
    }
    return () => {
      cancelAnimationFrame(raf);
      box.removeEventListener("nentra:fx-ready", onReady);
      window.removeEventListener(REVEAL_EVENT, runWave);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <div ref={boxRef} className="hero-lockup">
      <Image
        ref={cleanRef}
        src={SRC}
        alt="Nentra"
        width={W}
        height={H}
        loading="eager"
        fetchPriority="high"
        sizes="(max-width: 1073px) 82vw, 880px"
      />
      {fxMounted ? (
        <svg
          ref={fxRef}
          viewBox={`0 0 ${W} ${H}`}
          aria-hidden="true"
          focusable="false"
          style={{ opacity: 0 }}
        >
          <defs>
            <filter
              id="nentra-melt"
              x="-12%"
              y="-50%"
              width="124%"
              height="200%"
              colorInterpolationFilters="sRGB"
            >
              <feTurbulence
                ref={turbRef}
                type="fractalNoise"
                baseFrequency="0.0055 0.02"
                numOctaves={2}
                seed={7}
                result="flow"
              />
              <feDisplacementMap
                ref={dispRef}
                in="SourceGraphic"
                in2="flow"
                scale={0}
                xChannelSelector="R"
                yChannelSelector="G"
                result="moved"
              />
              <feTurbulence type="turbulence" baseFrequency="0.03 0.075" numOctaves={1} seed={3} result="marble" />
              <feColorMatrix
                ref={holesRef}
                in="marble"
                type="matrix"
                values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -4 6"
                result="holes"
              />
              <feComposite in="moved" in2="holes" operator="in" result="cut" />
              <feComponentTransfer in="cut">
                <feFuncA type="discrete" tableValues="0 1" />
              </feComponentTransfer>
            </filter>
          </defs>
          <image
            href={SRC}
            width={W}
            height={H}
            filter="url(#nentra-melt)"
            onLoad={() => {
              fxReady.current = true;
              boxRef.current?.dispatchEvent(new Event("nentra:fx-ready"));
            }}
          />
        </svg>
      ) : null}
    </div>
  );
}
