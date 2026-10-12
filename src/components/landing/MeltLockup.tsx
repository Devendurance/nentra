"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";

import { NOISE, createProgram, fitCanvas } from "./gl";
import { REVEAL_EVENT } from "./intro-state";

const SRC = "/brand/nentra/nentra-lockup.png";
const W = 1225;
const H = 267;

// Canvas padding around the lockup so fragments can travel without clipping.
const PAD_X = 0.12;
const PAD_Y = 0.8;

/**
 * Timeline in ms, modelled on reference C: a melt that travels left to right,
 * a sustained liquid phase, then a left-to-right reform, separated by clean holds.
 */
const FORM_MS = 2600;
const HOLD_MS = 5400;
const MELT_IN_MS = 3000;
const SUSTAIN_MS = 2400;
const REFORM_MS = 3600;
const CYCLE_MS = HOLD_MS + MELT_IN_MS + SUSTAIN_MS + REFORM_MS;

const FRAGMENT = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform vec4 uBox;
uniform float uTime;
uniform float uMelt;
uniform float uHeal;
uniform vec3 uPtr;
${NOISE}

float logo(vec2 p) {
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) return 0.0;
  return texture2D(uTex, p).a;
}

void main() {
  vec2 uv = vUv;
  float aspect = uRes.x / uRes.y;
  vec2 lx = (uv - uBox.xy) / uBox.zw;
  vec2 pp = vec2(uv.x * aspect, uv.y);

  float front = lx.x + (noise(vec2(lx.y * 2.5, uTime * 0.35)) - 0.5) * 0.22;
  float m = smoothstep(-0.14, 0.14, uMelt - front) * (1.0 - smoothstep(-0.14, 0.14, uHeal - front));
  float pd = length(pp - vec2(uPtr.x * aspect, uPtr.y));
  m = max(m, uPtr.z * (1.0 - smoothstep(0.05, 0.42, pd)));

  if (m < 0.003) {
    float a0 = logo(lx);
    gl_FragColor = vec4(vec3(0.992) * a0, a0);
    return;
  }

  float t = uTime * 0.22;
  vec2 q = pp * 2.4;
  vec2 w1 = vec2(fbm(q + vec2(0.0, t)), fbm(q + vec2(5.2, 1.3) - t));
  vec2 w2 = vec2(fbm(q + 3.6 * w1 + vec2(1.7, 9.2) + t * 0.8),
                 fbm(q + 3.6 * w1 + vec2(8.3, 2.8) - t * 0.7));
  // capped so the word stays partly readable at the peak, as in reference C
  float e = m * m * (3.0 - 2.0 * m);
  vec2 disp = (w2 - 0.5) * vec2(0.17, 0.27) * e;
  disp.x += (w1.y - 0.5) * 0.07 * e;
  float a = logo((uv + disp - uBox.xy) / uBox.zw);

  // marbled contour bands that cut through the displaced letters
  float field = fbm(q * 1.7 + 4.2 * w2 + t);
  float bands = abs(fract(field * 7.5 + uTime * 0.12) - 0.5) * 2.0;
  a *= mix(1.0, smoothstep(0.05, 0.3, bands), smoothstep(0.3, 0.75, m));

  // torn fragments
  float tear = noise(pp * 10.0 + w2 * 7.0);
  a *= 1.0 - step(tear, m * 0.36 - 0.14);

  // hard threshold once melting so fragments stay crisp, never blurry
  a = mix(a, step(0.5, a), smoothstep(0.0, 0.2, m));
  gl_FragColor = vec4(vec3(0.992) * a, a);
}`;

/**
 * The official lockup with an automatic melt and reform adapted from reference C.
 * The clean PNG is always the static and fallback state. The canvas only takes over
 * while the effect runs, so the two are never visible together.
 */
export function MeltLockup() {
  const cleanRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const clean = cleanRef.current;
    if (!canvas || !clean) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = createProgram(canvas, FRAGMENT, true);
    if (!ctx) return;
    const { gl, uniform } = ctx;

    let textureReady = false;
    const texture = gl.createTexture();
    const image = new window.Image();
    image.decoding = "async";
    image.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      textureReady = true;
    };
    image.src = SRC;

    const box = [PAD_X / (1 + 2 * PAD_X), PAD_Y / (1 + 2 * PAD_Y), 1 / (1 + 2 * PAD_X), 1 / (1 + 2 * PAD_Y)];
    const scale = Math.min(window.devicePixelRatio || 1, 1.5);

    // Timeline clock that only advances while the hero is visible.
    let clock = -1;
    let last = 0;
    let raf = 0;
    let visible = true;
    let showingCanvas = false;
    let ptrX = 0;
    let ptrY = 0;
    let ptrEnergy = 0;

    const state = (ms: number) => {
      if (ms < 0) return { melt: -0.3, heal: -0.3 };
      if (ms < FORM_MS) {
        const p = ms / FORM_MS;
        return { melt: 1.4, heal: -0.3 + easeInOut(p) * 1.7 };
      }
      const c = (ms - FORM_MS) % CYCLE_MS;
      if (c < HOLD_MS) return { melt: -0.3, heal: -0.3 };
      const k = c - HOLD_MS;
      if (k < MELT_IN_MS) return { melt: -0.3 + easeInOut(k / MELT_IN_MS) * 1.7, heal: -0.3 };
      if (k < MELT_IN_MS + SUSTAIN_MS) return { melt: 1.4, heal: -0.3 };
      return { melt: 1.4, heal: -0.3 + easeInOut((k - MELT_IN_MS - SUSTAIN_MS) / REFORM_MS) * 1.7 };
    };

    const show = (on: boolean) => {
      if (on === showingCanvas) return;
      showingCanvas = on;
      canvas.style.opacity = on ? "1" : "0";
      clean.style.opacity = on ? "0" : "1";
    };

    const frame = (now: number) => {
      raf = 0;
      if (!visible) return;
      const dt = last ? Math.min(64, now - last) : 16;
      last = now;
      if (clock >= 0) clock += dt;
      ptrEnergy *= 0.94;
      const { melt, heal } = state(clock);
      const active = textureReady && (melt > heal + 0.01 || ptrEnergy > 0.02);
      if (active) {
        fitCanvas(canvas, gl, scale);
        gl.uniform2f(uniform("uRes"), canvas.width, canvas.height);
        gl.uniform4f(uniform("uBox"), box[0], box[1], box[2], box[3]);
        gl.uniform1f(uniform("uTime"), now / 1000);
        gl.uniform1f(uniform("uMelt"), melt);
        gl.uniform1f(uniform("uHeal"), heal);
        gl.uniform3f(uniform("uPtr"), ptrX, ptrY, Math.min(1, ptrEnergy));
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      show(active);
      raf = requestAnimationFrame(frame);
    };

    const start = () => {
      if (!raf && visible) {
        last = 0;
        raf = requestAnimationFrame(frame);
      }
    };

    const onReveal = () => {
      clock = 0;
      start();
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const rect = canvas.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width;
      const y = 1 - (event.clientY - rect.top) / rect.height;
      if (x < 0 || x > 1 || y < 0.15 || y > 0.85) return;
      const travelled = Math.hypot(x - ptrX, y - ptrY);
      ptrX = x;
      ptrY = y;
      ptrEnergy = Math.min(1.3, ptrEnergy + travelled * 6);
    };

    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting && !document.hidden;
      if (visible) start();
    });
    observer.observe(canvas);
    const onVisibility = () => {
      visible = !document.hidden;
      if (visible) start();
    };

    // The intro always plays, so the cycle begins at the hand-off. If the hand-off
    // already happened (client navigation), begin straight away.
    window.addEventListener(REVEAL_EVENT, onReveal);
    if (document.documentElement.dataset.intro === "reveal") onReveal();
    document.addEventListener("visibilitychange", onVisibility);
    if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      window.addEventListener("pointermove", onMove, { passive: true });
    }
    start();

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener(REVEAL_EVENT, onReveal);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("visibilitychange", onVisibility);
      // Never force-lose the context here: effects can re-run on the same canvas
      // (StrictMode, fast refresh) and getContext would return the lost context.
      image.onload = null;
      gl.deleteTexture(texture);
      canvas.style.opacity = "0";
      clean.style.opacity = "";
    };
  }, []);

  return (
    <div className="hero-lockup">
      <Image
        ref={cleanRef}
        src={SRC}
        alt="Nentra"
        width={W}
        height={H}
        loading="eager"
        fetchPriority="high"
        sizes="(max-width: 1128px) 78vw, 880px"
      />
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="melt-canvas"
        style={{
          left: `${-PAD_X * 100}%`,
          top: `${-PAD_Y * 100}%`,
          width: `${(1 + 2 * PAD_X) * 100}%`,
          height: `${(1 + 2 * PAD_Y) * 100}%`,
        }}
      />
    </div>
  );
}

function easeInOut(p: number) {
  const x = Math.min(1, Math.max(0, p));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}
