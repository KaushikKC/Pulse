import { THEMES } from "../themes.ts";

interface Props {
  current: string;
  onPick: (id: string) => void;
  /** Compact variant for the in-room control. */
  compact?: boolean;
}

/**
 * Theme gallery — swappable premium looks. Each swatch previews the theme's
 * background + team-color gradient; premium looks carry a PRO badge (the paid
 * tier in the product vision).
 */
export function ThemePicker({ current, onPick, compact }: Props) {
  return (
    <div className={`theme-picker ${compact ? "compact" : ""}`}>
      {THEMES.map((t) => (
        <button
          key={t.id}
          className={`theme-swatch ${t.id === current ? "selected" : ""}`}
          style={{ ["--bg" as string]: t.bg }}
          onClick={() => onPick(t.id)}
          title={t.name}
        >
          <span
            className="swatch-orbs"
            style={{ background: `linear-gradient(115deg, ${t.home}, ${t.accent}, ${t.away})` }}
          />
          <span className="swatch-name">{t.name}</span>
          {t.premium && <span className="swatch-pro">PRO</span>}
          {t.id === current && <span className="swatch-check">✓</span>}
        </button>
      ))}
    </div>
  );
}
