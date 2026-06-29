import { REACTIONS, REACTION_META, type ReactionType } from "@pulse/shared";

interface Props {
  onReact: (type: ReactionType) => void;
  /** Live counts this window, for the little pulse badges. */
  counts?: Record<ReactionType, number>;
}

/**
 * Tap-to-react bar — the entire interaction model. Zero learning curve: one tap
 * sends your feeling into the collective canvas.
 */
export function ReactionBar({ onReact, counts }: Props) {
  return (
    <div className="reaction-bar">
      {REACTIONS.map((type) => {
        const meta = REACTION_META[type];
        return (
          <button
            key={type}
            className="react-btn"
            style={{ ["--c" as string]: meta.color }}
            onClick={() => {
              onReact(type);
              // Tactile feedback on mobile.
              navigator.vibrate?.(12);
            }}
          >
            <span className="react-emoji">{meta.emoji}</span>
            <span className="react-label">{meta.label}</span>
            {counts && counts[type] > 0 && (
              <span className="react-count">{counts[type]}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
