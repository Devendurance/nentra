"use client";

import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from "lucide-react";

import { type CaseEvent, eventTone } from "./types";

type Props = {
  events: CaseEvent[];
  index: number;
  playing: boolean;
  speed: 1 | 2;
  onPlay: () => void;
  onPause: () => void;
  onRestart: () => void;
  onStep: (delta: number) => void;
  onSeek: (index: number) => void;
  onSpeed: () => void;
};

export function ReplayControls({ events, index, playing, speed, onPlay, onPause, onRestart, onStep, onSeek, onSpeed }: Props) {
  const total = events.length;
  return (
    <div className="replay" role="group" aria-label="Replay controls">
      <div className="replay-buttons">
        <button type="button" className="ctrl" onClick={onRestart} aria-label="Restart replay">
          <RotateCcw size={16} aria-hidden="true" />
        </button>
        <button type="button" className="ctrl" onClick={() => onStep(-1)} disabled={index <= 1} aria-label="Previous event">
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="ctrl ctrl-main"
          onClick={playing ? onPause : onPlay}
          aria-label={playing ? "Pause replay" : index >= total ? "Replay from start" : "Play replay"}
        >
          {playing ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
        </button>
        <button type="button" className="ctrl" onClick={() => onStep(1)} disabled={index >= total} aria-label="Next event">
          <ChevronRight size={18} aria-hidden="true" />
        </button>
        <button type="button" className="ctrl ctrl-speed" onClick={onSpeed} aria-label={`Playback speed ${speed}x. Change speed`}>
          {speed}x
        </button>
      </div>

      <div className="scrub">
        <div className="ticks" aria-hidden="true">
          {events.map((event, i) => (
            <span
              key={event.seq}
              className={`tick tone-${eventTone(event.type)}${i < index ? " is-past" : ""}${i === index - 1 ? " is-now" : ""}`}
              onClick={() => onSeek(i + 1)}
            />
          ))}
        </div>
        <input
          type="range"
          min={0}
          max={total}
          step={1}
          value={index}
          onChange={(event) => onSeek(Number(event.target.value))}
          aria-label="Replay position"
          aria-valuetext={`Event ${index} of ${total}`}
        />
      </div>

      <p className="replay-count" aria-live="off">
        <span className="tabular">{String(index).padStart(2, "0")}</span>
        <span className="muted"> / {total}</span>
      </p>
    </div>
  );
}
