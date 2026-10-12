"use client";

import { useEffect, useRef } from "react";

import { NOISE, createProgram, fitCanvas } from "./gl";

/**
 * Living ember field adapted from reference C: a staggered lattice of dark forms and
 * warm highlights, domain-warped so the shapes drift, stretch and reshape continuously.
 * Rendered at a fraction of CSS resolution because the field is intentionally soft.
 * The CSS gradient field underneath remains the static and reduced-motion fallback.
 */
const FRAGMENT = `
precision mediump float;
varying vec2 vUv;
uniform vec2 uRes;
uniform float uTime;
${NOISE}

void main() {
  vec2 uv = vUv;
  float aspect = uRes.x / uRes.y;
  vec2 p = vec2(uv.x * aspect, uv.y);
  float t = uTime;

  vec2 q = p * 1.5 + vec2(t * 0.03, -t * 0.018);
  vec2 w = vec2(fbm(q + vec2(0.0, t * 0.07)), fbm(q + vec2(5.2, 1.3) - t * 0.06));
  vec2 w2 = vec2(fbm(q + 2.0 * w + vec2(1.7, 9.2) + t * 0.05), fbm(q + 2.0 * w + vec2(8.3, 2.8) - t * 0.04));

  vec2 lp = p * 2.15 + (w2 - 0.5) * 1.35 + vec2(t * 0.085, t * 0.04);
  float v = sin(lp.x * 3.14159) * sin(lp.y * 3.14159);
  v += (fbm(p * 1.8 + w * 1.2 - t * 0.07) - 0.5) * 0.55;

  float dark = smoothstep(-0.1, 1.2, v);
  float light = smoothstep(-0.05, 1.1, -v);

  // keep the brightest highlights out of the text column so cream copy stays readable
  vec2 c = (uv - vec2(0.5, 0.5)) * vec2(aspect * 0.75, 1.45);
  float safe = smoothstep(0.34, 0.85, length(c));
  light *= mix(0.12, 1.0, safe);

  vec3 rust = vec3(0.478, 0.165, 0.055);
  vec3 ember = vec3(0.71, 0.267, 0.059);
  vec3 amber = vec3(0.949, 0.541, 0.18);
  vec3 gold = vec3(0.961, 0.71, 0.38);
  vec3 shadow = vec3(0.075, 0.055, 0.03);
  vec3 olive = vec3(0.149, 0.145, 0.059);

  vec3 col = mix(ember, mix(amber, gold, smoothstep(0.45, 1.0, light)), light);
  vec3 deep = mix(rust, mix(olive, shadow, 0.6), smoothstep(0.2, 0.9, dark));
  col = mix(col, deep, smoothstep(0.0, 0.85, dark) * 0.92);
  col *= mix(0.84, 1.0, safe);
  gl_FragColor = vec4(col, 1.0);
}`;

const FRAME_MS = 1000 / 30;

export function EmberCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = createProgram(canvas, FRAGMENT, false);
    if (!ctx) return;
    const { gl, uniform } = ctx;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const scale = canvas.clientWidth < 700 ? 0.5 : 0.34;
    const seed = 40 + Math.random() * 60;

    let raf = 0;
    let visible = true;
    let last = 0;
    let elapsed = 0;

    const draw = () => {
      fitCanvas(canvas, gl, scale);
      gl.uniform2f(uniform("uRes"), canvas.width, canvas.height);
      gl.uniform1f(uniform("uTime"), seed + elapsed / 1000);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      canvas.dataset.ready = "true";
    };

    if (reduce) {
      draw();
      return;
    }

    const frame = (now: number) => {
      raf = 0;
      if (!visible) return;
      const dt = last ? now - last : FRAME_MS;
      if (dt >= FRAME_MS - 1) {
        elapsed += Math.min(100, dt);
        last = now;
        draw();
      }
      raf = requestAnimationFrame(frame);
    };
    const start = () => {
      if (!raf && visible) {
        last = 0;
        raf = requestAnimationFrame(frame);
      }
    };

    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting && !document.hidden;
      start();
    });
    observer.observe(canvas);
    const onVisibility = () => {
      visible = !document.hidden;
      start();
    };
    document.addEventListener("visibilitychange", onVisibility);
    start();

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <canvas ref={ref} className="ember-canvas" aria-hidden="true" />;
}
