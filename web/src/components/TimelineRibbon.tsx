import { useMemo, useRef } from "react";
import type { VerifiedMoment } from "@pulse/shared";
import type { TimelinePoint } from "../usePulse.ts";

interface Props {
  timeline: TimelinePoint[];
  moments: VerifiedMoment[];
  /** Current scrub position as a 0..1 ratio across the match, or null when live. */
  scrub: number | null;
  /** Called with a ratio while scrubbing, or null when released back to live. */
  onScrub: (ratio: number | null) => void;
  onOpenMoment: (m: VerifiedMoment) => void;
}

const EVENT_EMOJI: Record<string, string> = { goal: "⚽", red_card: "🟥", full_time: "🏁" };
const VIEW_W = 600;
const VIEW_H = 48;

/**
 * The emotional timeline — a scrubbable ribbon of the whole match's collective
 * intensity, with the captured moments pinned along it. Grab and drag to relive
 * the arc: the canvas re-surges to that instant and the eruptions replay. Release
 * to snap back to LIVE.
 */
export function TimelineRibbon({ timeline, moments, scrub, onScrub, onOpenMoment }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);

  const span = useMemo(() => {
    if (timeline.length < 2) return null;
    const t0 = timeline[0].t;
    const t1 = timeline[timeline.length - 1].t;
    return t1 > t0 ? { t0, t1 } : null;
  }, [timeline]);

  // Area + line paths of the intensity history, downsampled to keep the DOM light.
  const { areaPath, linePath } = useMemo(() => {
    if (!span) return { areaPath: "", linePath: "" };
    const N = Math.min(160, timeline.length);
    const step = timeline.length / N;
    const pts: string[] = [];
    for (let i = 0; i < N; i++) {
      const s = timeline[Math.min(timeline.length - 1, Math.floor(i * step))];
      const x = ((s.t - span.t0) / (span.t1 - span.t0)) * VIEW_W;
      const y = VIEW_H - Math.min(1, s.i) * (VIEW_H - 4) - 2;
      pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    const line = `M${pts.join(" L")}`;
    return { areaPath: `M0,${VIEW_H} L${pts.join(" L")} L${VIEW_W},${VIEW_H} Z`, linePath: line };
  }, [timeline, span]);

  if (!span) return null;

  const ratioOf = (ts: number) => (ts - span.t0) / (span.t1 - span.t0);
  const playhead = scrub ?? 1;

  const ratioFromEvent = (clientX: number): number => {
    const rect = trackRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  };

  const startScrub = (e: React.PointerEvent) => {
    trackRef.current?.setPointerCapture?.(e.pointerId);
    onScrub(ratioFromEvent(e.clientX));
  };
  const moveScrub = (e: React.PointerEvent) => {
    if (scrub == null) return;
    onScrub(ratioFromEvent(e.clientX));
  };
  const endScrub = () => onScrub(null);

  const scrubTimeLabel = () => {
    const t = span.t0 + (span.t1 - span.t0) * playhead;
    const secs = Math.max(0, Math.round((t - span.t0) / 1000));
    return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  };

  return (
    <div className="timeline">
      <div className="timeline-head">
        <span className={`timeline-mode ${scrub == null ? "live" : "review"}`}>
          {scrub == null ? (
            <>
              <span className="live-dot" /> LIVE
            </>
          ) : (
            <>⟲ RELIVING · {scrubTimeLabel()}</>
          )}
        </span>
        <span className="timeline-hint">drag to relive the match</span>
      </div>

      <div
        ref={trackRef}
        className="timeline-track"
        onPointerDown={startScrub}
        onPointerMove={moveScrub}
        onPointerUp={endScrub}
        onPointerCancel={endScrub}
      >
        <svg className="timeline-svg" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="none">
          <defs>
            <linearGradient id="tl-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style={{ stopColor: "var(--accent)" }} stopOpacity="0.32" />
              <stop offset="100%" style={{ stopColor: "var(--accent)" }} stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill="url(#tl-fill)" />
          <path
            d={linePath}
            fill="none"
            style={{ stroke: "var(--accent)" }}
            strokeWidth="1.5"
            opacity="0.85"
          />
        </svg>

        {/* Moment markers pinned at their timestamps. */}
        {moments.map((m) => {
          const r = ratioOf(m.ts);
          if (r < 0 || r > 1) return null;
          const verified = m.verification.status === "verified";
          return (
            <button
              key={m.id}
              className={`timeline-marker ${verified ? "verified" : ""}`}
              style={{ left: `${r * 100}%` }}
              title={`${m.label} · ${m.score[0]}–${m.score[1]}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onOpenMoment(m);
              }}
            >
              {EVENT_EMOJI[m.eventType] ?? "✨"}
            </button>
          );
        })}

        {/* Playhead. */}
        <div className={`timeline-playhead ${scrub == null ? "live" : ""}`} style={{ left: `${playhead * 100}%` }} />
      </div>
    </div>
  );
}
