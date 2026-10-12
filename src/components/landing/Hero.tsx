import { ArrowDown, ArrowRight } from "lucide-react";
import Link from "next/link";

import { EmberCanvas } from "./EmberCanvas";
import { MeltLockup } from "./MeltLockup";

const LIGHTS = [
  { left: "-8%", top: "-18%", size: "52vw", dur: "14.4s", dx: "3vw", dy: "2vh" },
  { left: "74%", top: "62%", size: "48vw", dur: "19.2s", dx: "-3vw", dy: "-2vh" },
  { left: "82%", top: "-24%", size: "34vw", dur: "16.8s", dx: "-2vw", dy: "3vh" },
  { left: "-10%", top: "70%", size: "36vw", dur: "12s", dx: "2vw", dy: "-2vh" },
];

const BLOTS = [
  { left: "14%", top: "8%", size: "30vw", dur: "9.6s", dx: "3vw", dy: "2vh", delay: "-2s" },
  { left: "48%", top: "-14%", size: "28vw", dur: "14.4s", dx: "-3vw", dy: "3vh", delay: "-6s" },
  { left: "78%", top: "18%", size: "26vw", dur: "12s", dx: "2vw", dy: "-3vh", delay: "-1s" },
  { left: "2%", top: "46%", size: "26vw", dur: "16.8s", dx: "-2vw", dy: "2vh", delay: "-9s" },
  { left: "36%", top: "64%", size: "32vw", dur: "10.8s", dx: "3vw", dy: "-2vh", delay: "-4s" },
  { left: "64%", top: "78%", size: "24vw", dur: "13.2s", dx: "-3vw", dy: "-2vh", delay: "-7s" },
];

function Field() {
  return (
    <div className="ember-field" aria-hidden="true">
      {LIGHTS.map((l, i) => (
        <span
          key={`l${i}`}
          className="ember-light"
          style={
            {
              left: l.left,
              top: l.top,
              width: l.size,
              height: l.size,
              minWidth: 320,
              minHeight: 320,
              "--dur": l.dur,
              "--dx": l.dx,
              "--dy": l.dy,
            } as React.CSSProperties
          }
        />
      ))}
      {BLOTS.map((b, i) => (
        <span
          key={`b${i}`}
          className="ember-blot"
          style={
            {
              left: b.left,
              top: b.top,
              width: b.size,
              height: b.size,
              minWidth: 260,
              minHeight: 260,
              "--dur": b.dur,
              "--dx": b.dx,
              "--dy": b.dy,
              "--delay": b.delay,
            } as React.CSSProperties
          }
        />
      ))}
      <EmberCanvas />
      <span className="ember-scrim" />
    </div>
  );
}

export function Hero() {
  return (
    <section id="top" className="hero grain" aria-labelledby="hero-title">
      <Field />
      <div className="relative z-[4] flex flex-1 flex-col items-center justify-center px-[var(--side)] pb-28 pt-[calc(var(--nav-h)+40px)] text-center sm:pb-32">
        <p className="micro-label hero-reveal mb-7 !text-cream lg:hidden" style={{ "--i": 0 } as React.CSSProperties}>
          AI order operations for online merchants
        </p>
        <h1 id="hero-title" className="flex flex-col items-center">
          <span className="hero-reveal block" style={{ "--i": 0 } as React.CSSProperties}>
            <MeltLockup />
          </span>
          <span className="hero-line hero-reveal mt-7 block sm:mt-9" style={{ "--i": 1 } as React.CSSProperties}>
            There is always a next move.
          </span>
        </h1>
        <p className="hero-sub hero-reveal mt-5" style={{ "--i": 2 } as React.CSSProperties}>
          Nentra investigates order exceptions, coordinates the next action, and helps merchants move orders toward
          verified fulfilment.
        </p>
        <div
          className="hero-reveal mt-9 flex flex-wrap items-center justify-center gap-3"
          style={{ "--i": 3 } as React.CSSProperties}
        >
          <Link href="/app" className="btn btn-cream">
            Watch a recovery
            <ArrowRight aria-hidden="true" size={18} strokeWidth={2} />
          </Link>
          <a href="#how-it-works" className="btn btn-outline">
            How it works
            <ArrowDown aria-hidden="true" size={18} strokeWidth={2} />
          </a>
        </div>
      </div>

      <div
        className="hero-reveal pointer-events-none absolute inset-x-0 bottom-0 z-[4] hidden justify-between px-[var(--side)] pb-8 lg:flex"
        style={{ "--i": 4 } as React.CSSProperties}
      >
        <p className="corner-block">
          ai order operations
          <br />
          for online merchants.
        </p>
        <p className="corner-block text-right">
          investigate. coordinate.
          <br />
          approve. verify.
        </p>
      </div>
    </section>
  );
}
