import { useState } from "react";
import { PHASE_LABEL, type RoomState, type Side } from "@pulse/shared";

interface Props {
  room: RoomState | null;
  connected: boolean;
  team: Side;
  homeColor: string;
  awayColor: string;
  /** Shareable deep link into this room (?join=<fixtureId>). */
  inviteUrl: string;
}

/** Broadcast-style TV "score bug" + presence — the machine-truth header. */
export function RoomHeader({ room, connected, team, homeColor, awayColor, inviteUrl }: Props) {
  const [copied, setCopied] = useState(false);

  const home = room?.participants[0] ?? "Home";
  const away = room?.participants[1] ?? "Away";
  const score = room?.score ?? [0, 0];
  const phase = room ? PHASE_LABEL[room.phase] ?? "" : "";
  const live = room && room.phase >= 2 && room.phase <= 13;

  const invite = () => {
    navigator.clipboard
      ?.writeText(inviteUrl)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      })
      .catch(() => window.prompt("Share this link with a friend:", inviteUrl));
  };

  return (
    <header className="room-header">
      <div className="score-bug">
        <span className="bug-side bug-home" style={{ ["--c" as string]: homeColor }}>
          <span className="bug-code" title={home}>{code(home)}</span>
          {team === 1 && <span className="you-tag">YOU</span>}
        </span>
        <span className="bug-score">
          {score[0]}
          <i>–</i>
          {score[1]}
        </span>
        <span className="bug-side bug-away" style={{ ["--c" as string]: awayColor }}>
          {team === 2 && <span className="you-tag">YOU</span>}
          <span className="bug-code" title={away}>{code(away)}</span>
        </span>
      </div>

      <div className="bug-meta">
        {live && (
          <span className="meta-chip live-chip">
            <span className="live-dot" /> LIVE
          </span>
        )}
        <span className="meta-chip">
          {phase}
          {room?.minute != null && live ? ` · ${room.minute}'` : ""}
        </span>
        <span className={`meta-chip conn ${connected ? "ok" : "off"}`}>
          {connected ? "● connected" : "○ reconnecting"}
        </span>
        <span className="meta-chip">👥 {room?.present ?? 0}</span>
        <button className="invite-btn" onClick={invite}>
          {copied ? "✓ Link copied" : "⚡ Invite"}
        </button>
      </div>
    </header>
  );
}

/** 3-letter broadcast code, e.g. Argentina → ARG. */
const code = (name: string) => name.replace(/[^a-z]/gi, "").slice(0, 3).toUpperCase() || "———";
