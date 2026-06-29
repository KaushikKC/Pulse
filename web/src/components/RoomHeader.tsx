import { PHASE_LABEL, type RoomState, type Side } from "@pulse/shared";

interface Props {
  room: RoomState | null;
  connected: boolean;
  team: Side;
  homeColor: string;
  awayColor: string;
}

/** Scoreboard + presence — the "machine truth" header above the emotion field. */
export function RoomHeader({ room, connected, team, homeColor, awayColor }: Props) {
  const home = room?.participants[0] ?? "Home";
  const away = room?.participants[1] ?? "Away";
  const score = room?.score ?? [0, 0];
  const phase = room ? PHASE_LABEL[room.phase] ?? "" : "";
  const live = room && room.phase >= 2 && room.phase <= 13;

  return (
    <header className="room-header">
      <div className="team team-home" style={{ color: homeColor }}>
        <span className="team-name">{home}</span>
        {team === 1 && <span className="you-badge">YOU</span>}
      </div>

      <div className="scoreboard">
        <span className="score">
          {score[0]}<span className="score-dash">–</span>{score[1]}
        </span>
        <span className="phase">
          {live && <span className="live-dot" />}
          {phase}
          {room?.minute != null && live ? ` · ${room.minute}'` : ""}
        </span>
      </div>

      <div className="team team-away" style={{ color: awayColor }}>
        {team === 2 && <span className="you-badge">YOU</span>}
        <span className="team-name">{away}</span>
      </div>

      <div className="meta-row">
        <span className={`conn ${connected ? "ok" : "off"}`}>
          {connected ? "● live" : "○ reconnecting"}
        </span>
        <span className="present">👥 {room?.present ?? 0} watching</span>
      </div>
    </header>
  );
}
