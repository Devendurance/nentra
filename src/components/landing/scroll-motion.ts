"use client";

import { type RefObject, useEffect, useState, useSyncExternalStore } from "react";

type Gsap = typeof import("gsap").gsap;
type ScrollTriggerStatic = typeof import("gsap/ScrollTrigger").ScrollTrigger;
export type ScrollTriggerInstance = InstanceType<ScrollTriggerStatic>;

let loader: Promise<{ gsap: Gsap; ScrollTrigger: ScrollTriggerStatic }> | null = null;

/**
 * GSAP and ScrollTrigger load on demand, only for the pinned desktop scenes, so the hero
 * never waits on the motion bundle.
 */
export function loadScrollTrigger() {
  loader ??= Promise.all([import("gsap"), import("gsap/ScrollTrigger")]).then(([g, s]) => {
    g.gsap.registerPlugin(s.ScrollTrigger);
    return { gsap: g.gsap, ScrollTrigger: s.ScrollTrigger };
  });
  return loader;
}

let refreshTimer = 0;
/** Debounced, so several scenes and late content settle in one recalculation. */
export function scheduleRefresh(ScrollTrigger: ScrollTriggerStatic) {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => {
    ScrollTrigger.sort();
    ScrollTrigger.refresh();
  }, 120);
}

/** Pinned, scrubbed scenes only on wide screens for visitors who allow motion. */
export const CINEMATIC_QUERY = "(min-width: 1024px) and (prefers-reduced-motion: no-preference)";

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** True while the element is near the viewport. Ambient loops pause otherwise. */
export function useInView(ref: RefObject<Element | null>, rootMargin = "120px"): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { rootMargin });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, rootMargin]);
  return inView;
}
