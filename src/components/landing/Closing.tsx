import { ArrowRight, ArrowUpRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import "./closing.css";

const REPO = "https://github.com/Devendurance/nentra";
const BLOB = `${REPO}/blob/main`;

const COLUMNS = [
  {
    title: "Explore",
    links: [
      { label: "How it works", href: "#how-it-works" },
      { label: "Why Nentra", href: "#why" },
      { label: "Proof", href: "#proof" },
      { label: "Recovery loop", href: "#loop" },
    ],
  },
  {
    title: "Product",
    links: [
      { label: "Nentra Floor", href: "/app", internal: true },
      { label: "Back to top", href: "#top" },
    ],
  },
  {
    title: "Project",
    links: [
      { label: "Source code", href: REPO, external: true },
      { label: "Design system", href: `${BLOB}/DESIGN.md`, external: true },
      { label: "Product language", href: `${BLOB}/docs/${encodeURIComponent("Nentra product language, UX and copy.md")}`, external: true },
      { label: "Demo evidence", href: `${BLOB}/docs/hackathon-demo-evidence.md`, external: true },
    ],
  },
] as const;

function FooterLink({ link }: { link: (typeof COLUMNS)[number]["links"][number] }) {
  if ("internal" in link)
    return (
      <Link className="footer-link" href={link.href}>
        {link.label}
      </Link>
    );
  if ("external" in link)
    return (
      <a className="footer-link" href={link.href} target="_blank" rel="noopener noreferrer">
        {link.label}
        <ArrowUpRight aria-hidden="true" size={13} />
        <span className="sr-only">(opens GitHub in a new tab)</span>
      </a>
    );
  return (
    <a className="footer-link" href={link.href}>
      {link.label}
    </a>
  );
}

export function ClosingCta() {
  return (
    <section className="closing" aria-labelledby="closing-title">
      <div className="container-n closing-band">
        <p className="eyebrow-pill">Nentra Floor</p>
        <h2 id="closing-title" className="closing-title">
          Keep the business moving when the order <span className="serif-accent">does not.</span>
        </h2>
        <p className="lead closing-lead">
          Watch Nentra work a recorded exception from the first check to a verified booking, one persisted event at a
          time.
        </p>
        <div className="closing-actions">
          <Link href="/app" className="btn btn-primary">
            Watch the full recovery
            <ArrowRight aria-hidden="true" size={18} />
          </Link>
          <a href={REPO} className="btn btn-outline" target="_blank" rel="noopener noreferrer">
            Read the source
            <ArrowUpRight aria-hidden="true" size={18} />
            <span className="sr-only">(opens GitHub in a new tab)</span>
          </a>
        </div>
      </div>
    </section>
  );
}

export function SiteFooter() {
  return (
    <footer className="footer grain">
      <div className="footer-glow" aria-hidden="true" />
      <div className="container-n footer-top">
        <div className="footer-brand">
          <Image
            src="/brand/nentra/nentra-lockup-nav.png"
            alt="Nentra"
            width={480}
            height={105}
            className="h-[32px] w-auto"
            sizes="160px"
          />
          <p className="footer-desc">
            AI order operations for online merchants.
            <br />
            There is always a next move.
          </p>
        </div>

        <nav className="footer-cols" aria-label="Footer">
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <h3 className="footer-head">{col.title}</h3>
              <ul>
                {col.links.map((link) => (
                  <li key={link.label}>
                    <FooterLink link={link} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <p className="footer-note">
          Demo data is fictional. Bookings shown are DEMO_SANDBOX bookings, and a booking is never reported as a delivery.
        </p>
      </div>

      <div className="footer-mark" aria-hidden="true">
        <Image src="/brand/nentra/nentra-lockup.png" alt="" width={1225} height={267} sizes="96vw" />
      </div>
    </footer>
  );
}
