import type { MatchEvent } from "@pulse/shared";

const ICON: Record<MatchEvent["type"], string> = {
  kickoff: "🟢",
  goal: "⚽",
  red_card: "🟥",
  yellow_card: "🟨",
  phase_change: "⏱️",
  momentum_swing: "📈",
  full_time: "🏁",
};

/** The match-event ticker — verified feed events that drive the canvas spikes. */
export function EventTicker({ events }: { events: MatchEvent[] }) {
  if (events.length === 0) {
    return <div className="ticker ticker-empty">Waiting for the match to breathe…</div>;
  }
  return (
    <div className="ticker">
      {events.map((e) => (
        <div key={e.id} className={`ticker-item type-${e.type}`}>
          <span className="ticker-icon">{ICON[e.type]}</span>
          <span className="ticker-label">{e.label}</span>
          {e.minute != null && <span className="ticker-min">{e.minute}'</span>}
        </div>
      ))}
    </div>
  );
}
