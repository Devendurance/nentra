"use client";

import { useSyncExternalStore } from "react";

export const REVEAL_EVENT = "nentra:reveal";

/** play: intro running (every page entry). reveal: intro handed over to the hero. skip: reduced motion. */
export type IntroState = "play" | "reveal" | "skip";

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-intro"] });
  return () => observer.disconnect();
}

function getSnapshot(): IntroState {
  const value = document.documentElement.dataset.intro;
  return value === "play" || value === "reveal" ? value : "skip";
}

export function useIntroState(serverState: IntroState = "play"): IntroState {
  return useSyncExternalStore(subscribe, getSnapshot, () => serverState);
}

export function revealHero() {
  document.documentElement.dataset.intro = "reveal";
  window.dispatchEvent(new Event(REVEAL_EVENT));
}
