"use client";

import { ArrowUpRight, Menu, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const SOURCE_URL = "https://github.com/Devendurance/nentra";

export function SiteNav() {
  const [open, setOpen] = useState(false);
  const [solid, setSolid] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const firstLinkRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const hero = document.getElementById("top");
    if (!hero) return;
    const observer = new IntersectionObserver(
      ([entry]) => setSolid(!entry.isIntersecting),
      { rootMargin: "-64px 0px 0px 0px", threshold: 0 },
    );
    const sentinel = document.createElement("div");
    sentinel.style.cssText = "position:absolute;left:0;right:0;bottom:15%;height:1px;pointer-events:none";
    hero.appendChild(sentinel);
    observer.observe(sentinel);
    return () => {
      observer.disconnect();
      sentinel.remove();
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    firstLinkRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const desktop = window.matchMedia("(min-width: 768px)");
    const onResize = () => desktop.matches && setOpen(false);
    window.addEventListener("keydown", onKey);
    desktop.addEventListener("change", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      desktop.removeEventListener("change", onResize);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <header
      className="site-nav hero-reveal"
      data-solid={solid}
      data-open={open}
      style={{ "--i": 3 } as React.CSSProperties}
    >
      <nav aria-label="Main" className="container-n flex h-full items-center justify-between">
        <a href="#top" className="-m-2 inline-flex items-center p-2" aria-label="Nentra, back to top">
          <Image
            src="/brand/nentra/nentra-lockup-nav.png"
            alt=""
            width={480}
            height={105}
            className="h-[22px] w-auto sm:h-6"
            sizes="120px"
          />
        </a>

        <ul className="hidden items-center gap-8 md:flex">
          <li>
            <a className="nav-link" href={SOURCE_URL} target="_blank" rel="noopener noreferrer">
              Source
              <ArrowUpRight aria-hidden="true" size={16} />
              <span className="sr-only">(opens GitHub in a new tab)</span>
            </a>
          </li>
          <li>
            <a className="nav-link" href="#how-it-works">
              How it works
            </a>
          </li>
          <li>
            <Link className="btn btn-outline btn-sm" href="/app">
              Open Nentra Floor
            </Link>
          </li>
        </ul>

        <button
          ref={buttonRef}
          type="button"
          className="-mr-2 inline-flex h-11 w-11 items-center justify-center rounded-full text-cream md:hidden"
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <X aria-hidden="true" size={22} /> : <Menu aria-hidden="true" size={22} />}
        </button>
      </nav>

      {open ? (
        <div id="mobile-menu" className="mobile-menu md:hidden">
          <ul className="container-n flex flex-col py-4">
            <li>
              <Link
                ref={firstLinkRef}
                href="/app"
                onClick={close}
                className="flex min-h-14 items-center border-b border-hairline text-2xl font-medium"
              >
                Open Nentra Floor
              </Link>
            </li>
            <li>
              <a
                href="#how-it-works"
                onClick={close}
                className="flex min-h-14 items-center border-b border-hairline text-2xl font-medium"
              >
                How it works
              </a>
            </li>
            <li>
              <a
                href={SOURCE_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={close}
                className="flex min-h-14 items-center gap-2 text-2xl font-medium"
              >
                Source
                <ArrowUpRight aria-hidden="true" size={20} />
                <span className="sr-only">(opens GitHub in a new tab)</span>
              </a>
            </li>
          </ul>
        </div>
      ) : null}
    </header>
  );
}
