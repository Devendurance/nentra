"use client";

import { useEffect } from "react";

/**
 * In-page anchors. A native hash jump pushes a history entry without the router's state, and
 * returning to that entry from another route (for example Back from /app) leaves the router
 * unable to restore the landing page. This keeps the router state on the new entry, then
 * scrolls and moves focus the way a native anchor would.
 */
export function HashNavigation() {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.('a[href^="#"]');
      const id = link?.getAttribute("href")?.slice(1);
      const target = id ? document.getElementById(id) : null;
      if (!target) return;
      event.preventDefault();
      if (location.hash !== `#${id}`) history.pushState(history.state, "", `#${id}`);
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
  return null;
}
