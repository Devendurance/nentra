"use client";

import { useEffect, useRef } from "react";

import { stationOf } from "./projection";
import { ACTOR_NAMES, type CaseEvent, EVENT_LABELS, STATION_NAMES, eventTone, formatClock, formatOffset } from "./types";

export function Timeline({ events, index, onInspect }: { events: CaseEvent[]; index: number; onInspect: (index: number) => void }) {
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!list || !row) return;
    const top = row.offsetTop - list.offsetTop;
    if (top < list.scrollTop || top + row.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTo({ top: top - list.clientHeight / 3, behavior: "smooth" });
    }
  }, [index]);

  const first = events[0];
  return (
    <section className="panel" aria-labelledby="timeline-title">
      <div className="panel-head">
        <h2 id="timeline-title" className="panel-title">
          Recorded timeline
        </h2>
        <p className="panel-note">
          {events.length} persisted events, in sequence order. Select one to inspect it on the floor.
        </p>
      </div>
      <ol ref={listRef} className="events">
        {events.map((event, i) => {
          const station = stationOf(event);
          const tone = eventTone(event.type);
          const isNow = i === index - 1;
          const future = i >= index;
          return (
            <li key={event.seq}>
              <button
                type="button"
                className={`event tone-${tone}${isNow ? " is-now" : ""}${future ? " is-future" : ""}`}
                aria-current={isNow ? "step" : undefined}
                onClick={() => onInspect(i + 1)}
              >
                <span className="event-seq tabular">{String(event.seq).padStart(2, "0")}</span>
                <span className="event-main">
                  <span className="event-line">
                    <span className={`event-type tone-${tone}`}>{EVENT_LABELS[event.type]}</span>
                    <span className="event-who">
                      {ACTOR_NAMES[event.actor]}
                      {station && station !== event.actor ? ` → ${STATION_NAMES[station]}` : ""}
                    </span>
                  </span>
                  <span className="event-title">{event.payload.title}</span>
                  <span className="event-summary">{event.payload.summary}</span>
                </span>
                <span className="event-time tabular">
                  {first ? formatOffset(first.occurredAt, event.occurredAt) : ""}
                  <span className="muted">{formatClock(event.occurredAt)}</span>
                  {event.payload.resultCode ? <span className="code">{event.payload.resultCode}</span> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
