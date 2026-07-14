import type { VerifiedMoment } from "@pulse/shared";

interface Props {
  moments: VerifiedMoment[];
  onOpen: (moment: VerifiedMoment) => void;
}

const EVENT_EMOJI: Record<string, string> = {
  goal: "⚽",
  red_card: "🟥",
  full_time: "🏁",
};

/**
 * A collectible strip of the moments captured this match. Each chip shows the
 * event + scoreline and a verification dot; tap to open the shareable card.
 */
export function MomentsRail({ moments, onOpen }: Props) {
  if (moments.length === 0) return null;

  return (
    <div className="moments-rail">
      <div className="moments-rail-label">
        MOMENTS <span>{moments.length}</span>
      </div>
      <div className="moments-strip">
        {moments.map((m) => (
          <button key={m.id} className="moment-chip" onClick={() => onOpen(m)}>
            <span className="chip-emoji">{EVENT_EMOJI[m.eventType] ?? "✨"}</span>
            <span className="chip-score">
              {m.score[0]}–{m.score[1]}
            </span>
            <span className={`chip-dot ${m.verification.status}`} />
          </button>
        ))}
      </div>
    </div>
  );
}
