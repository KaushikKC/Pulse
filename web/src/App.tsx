import { useEffect, useMemo, useState } from "react";
import type { FixtureSummary, Side } from "@pulse/shared";
import { usePulse } from "./usePulse.ts";
import { EmotionCanvas } from "./viz/EmotionCanvas.tsx";
import { RoomHeader } from "./components/RoomHeader.tsx";
import { ReactionBar } from "./components/ReactionBar.tsx";
import { EventTicker } from "./components/EventTicker.tsx";
import { Floaters } from "./components/Floaters.tsx";

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:4000";

const HOME_COLOR = "#38bdf8"; // home / participant 1
const AWAY_COLOR = "#f472b6"; // away / participant 2

export function App() {
  const [fixtures, setFixtures] = useState<FixtureSummary[]>([]);
  const [fixtureId, setFixtureId] = useState<string | null>(null);
  const [team, setTeam] = useState<Side | null>(null);

  // Load joinable fixtures.
  useEffect(() => {
    fetch(`${SERVER_URL}/api/fixtures`)
      .then((r) => r.json())
      .then((f: FixtureSummary[]) => {
        setFixtures(f);
        if (f[0]) setFixtureId(f[0].fixtureId);
      })
      .catch(() => setFixtures([]));
  }, []);

  const fixture = useMemo(
    () => fixtures.find((f) => f.fixtureId === fixtureId) ?? null,
    [fixtures, fixtureId],
  );

  // Only join once the fan has picked a side.
  const pulse = usePulse(team != null ? fixtureId : null, team ?? 0);

  if (team == null) {
    return (
      <Lobby
        fixture={fixture}
        connecting={!fixture}
        onPick={(side) => setTeam(side)}
      />
    );
  }

  return (
    <div className="app">
      <EmotionCanvas
        emotion={pulse.emotion}
        lastEvent={pulse.lastEvent}
        homeColor={HOME_COLOR}
        awayColor={AWAY_COLOR}
      />
      <Floaters pops={pulse.pops} />

      <div className="overlay">
        <RoomHeader
          room={pulse.room}
          connected={pulse.connected}
          team={team}
          homeColor={HOME_COLOR}
          awayColor={AWAY_COLOR}
        />

        <div className="spacer" />

        <EventTicker events={pulse.events} />
        <ReactionBar onReact={pulse.react} counts={pulse.emotion?.counts} />
      </div>
    </div>
  );
}

interface LobbyProps {
  fixture: FixtureSummary | null;
  connecting: boolean;
  onPick: (side: Side) => void;
}

function Lobby({ fixture, connecting, onPick }: LobbyProps) {
  const home = fixture?.participants[0] ?? "Home";
  const away = fixture?.participants[1] ?? "Away";

  return (
    <div className="lobby">
      <div className="brand">
        <h1>PULSE</h1>
        <p>Feel the match together. Tap your emotion — watch the crowd become one.</p>
      </div>

      {connecting ? (
        <p className="lobby-status">Finding a live match…</p>
      ) : (
        <>
          <p className="lobby-status">Pick your side for {home} vs {away}</p>
          <div className="side-pick">
            <button
              className="side-btn"
              style={{ ["--c" as string]: HOME_COLOR }}
              onClick={() => onPick(1)}
            >
              {home}
            </button>
            <button
              className="side-btn neutral"
              onClick={() => onPick(0)}
            >
              Just here for the vibes
            </button>
            <button
              className="side-btn"
              style={{ ["--c" as string]: AWAY_COLOR }}
              onClick={() => onPick(2)}
            >
              {away}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
