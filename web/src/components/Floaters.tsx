import { REACTION_META, type ReactionType, type Side } from "@pulse/shared";

interface Pop {
  id: number;
  type: ReactionType;
  team: Side;
  /** The fan's chant name — floats up with their emoji. */
  name?: string;
}

/**
 * Emoji floaters — every reaction (yours and everyone else's) drifts up the
 * screen, so you literally see the crowd reacting with you in real time.
 */
export function Floaters({ pops }: { pops: Pop[] }) {
  return (
    <div className="floaters">
      {pops.map((p) => (
        <span
          key={p.id}
          className="floater"
          style={{
            left: `${floaterX(p)}%`,
            color: REACTION_META[p.type].color,
          }}
        >
          <span className="floater-emoji">{REACTION_META[p.type].emoji}</span>
          {p.name && <span className="floater-name">{p.name}</span>}
        </span>
      ))}
    </div>
  );
}

/** Place the floater on the supporter's side of the field. */
function floaterX(p: Pop): number {
  const base = p.team === 1 ? 62 : p.team === 2 ? 38 : 50;
  return base + (Math.random() - 0.5) * 28;
}
