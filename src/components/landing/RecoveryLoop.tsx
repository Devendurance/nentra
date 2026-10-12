const STAGES = [
  ["Exception", "An order can no longer move safely to its next fulfilment step."],
  ["Investigation", "Nentra checks the order context and the evidence behind the exception."],
  ["Coordination", "Customer messages, delivery checks and fallback options are prepared in one place."],
  ["Bounded approval", "Consequential actions pause for your decision, with the evidence beside them."],
  ["Execution", "Approved actions run within the limits you set."],
  ["Verification", "The outcome is checked independently before anything is called recovered."],
  ["Escalation", "When recovery is not safe or possible, the case comes back to you with its record."],
] as const;

export function RecoveryLoop() {
  return (
    <section id="loop" aria-labelledby="loop-title" className="relative pb-[var(--section-y)]">
      <div className="container-n">
        <div className="max-w-3xl">
          <p className="eyebrow-pill">The recovery loop</p>
          <h2 id="loop-title" className="h2 mt-6">
            More than an alert. A <span className="serif-accent">way forward.</span>
          </h2>
          <p className="lead mt-5 max-w-2xl">
            The recorded run is one pass through the loop Nentra is designed to run for every exception. When recovery isn&apos;t safe
            or possible, the loop ends with the case back in your hands, not with a guess.
          </p>
        </div>

        <ol className="spotlight-grid mt-14 lg:mt-20" style={{ "--cols": 4 } as React.CSSProperties}>
          {STAGES.map(([title, body], i) => (
            <li key={title} className="spotlight-cell">
              <span className="cross tl" aria-hidden="true" />
              <span className="numeral">{String(i + 1).padStart(2, "0")}</span>
              <h3 className="mt-10 text-xl font-medium leading-7">{title}</h3>
              <p className="mt-3 text-base leading-[26px] text-cream/70">{body}</p>
            </li>
          ))}
          <li className="spotlight-cell flex flex-col justify-end">
            <span className="cross br" aria-hidden="true" />
            <p className="text-[22px] font-light leading-[30px] text-cream">
              A sent message is not a confirmed reply. A booking attempt is not a verified booking.
            </p>
          </li>
        </ol>
      </div>
    </section>
  );
}
