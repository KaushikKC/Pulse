import { useEffect, useMemo, useRef, useState } from "react";
import {
  PHASE_LABEL,
  type FixtureSummary,
  type MatchEvent,
  type Side,
  type VerifiedMoment,
} from "@pulse/shared";
import { usePulse } from "./usePulse.ts";
import { EmotionCanvas } from "./viz/EmotionCanvas.tsx";
import { RoomHeader } from "./components/RoomHeader.tsx";
import { ReactionBar } from "./components/ReactionBar.tsx";
import { EventTicker } from "./components/EventTicker.tsx";
import { Floaters } from "./components/Floaters.tsx";
import { MomentsRail } from "./components/MomentsRail.tsx";
import { MomentCard } from "./components/MomentCard.tsx";
import { TimelineRibbon } from "./components/TimelineRibbon.tsx";
import { ThemePicker } from "./components/ThemePicker.tsx";
import { Landing } from "./components/Landing.tsx";
import { applyThemeVars, loadThemeId, saveThemeId, themeById } from "./themes.ts";

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:4000";

/** Shareable room links: /?join=<fixtureId> drops a friend straight into your match. */
const invitedFixture = new URLSearchParams(window.location.search).get("join");

export function App() {
  const [fixtures, setFixtures] = useState<FixtureSummary[]>([]);
  const [fixtureId, setFixtureId] = useState<string | null>(null);
  const [team, setTeam] = useState<Side | null>(null);
  const [themeId, setThemeId] = useState<string>(() => loadThemeId());
  const [showThemes, setShowThemes] = useState(false);
  // Landing is the front door; an invite link (?join=) drops straight into the lobby.
  const [entered, setEntered] = useState<boolean>(() => invitedFixture != null);
  const [name, setName] = useState(() => localStorage.getItem("pulse:name") ?? "");
  const [openMoment, setOpenMoment] = useState<VerifiedMoment | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyErr, setVerifyErr] = useState<string | null>(null);
  // Timeline scrub: 0..1 ratio across the match while reliving, or null when live.
  const [scrub, setScrub] = useState<number | null>(null);
  const [burstEvent, setBurstEvent] = useState<MatchEvent | null>(null);
  const lastBurstId = useRef<string | null>(null);

  // Prove the on-chain integration live: verify a real TxLINE goal on Solana and
  // open it as a "✓ Verified" card — works even when no live goal is happening.
  const verifyRealGoal = () => {
    setVerifying(true);
    setVerifyErr(null);
    fetch(`${SERVER_URL}/api/moments/demo`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error ?? `HTTP ${r.status}`);
        return r.json();
      })
      .then((m: VerifiedMoment) => setOpenMoment(m))
      .catch((e) => setVerifyErr(e.message))
      .finally(() => setVerifying(false));
  };

  // Load joinable fixtures; keep polling while in the lobby so the match cards
  // show live scores ticking. An invite link pre-selects that match.
  useEffect(() => {
    if (team != null) return;
    let cancelled = false;
    const load = () =>
      fetch(`${SERVER_URL}/api/fixtures`)
        .then((r) => r.json())
        .then((f: FixtureSummary[]) => {
          if (cancelled) return;
          setFixtures(f);
          setFixtureId(
            (prev) =>
              prev ??
              (invitedFixture && f.some((x) => x.fixtureId === invitedFixture)
                ? invitedFixture
                : f[0]?.fixtureId ?? null),
          );
        })
        .catch(() => undefined);
    load();
    const t = setInterval(load, 4000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [team]);

  useEffect(() => {
    localStorage.setItem("pulse:name", name);
  }, [name]);

  // Apply the chosen premium theme: repaint CSS vars + persist.
  const theme = themeById(themeId);
  useEffect(() => {
    applyThemeVars(theme);
    saveThemeId(theme.id);
  }, [theme]);

  const fixture = useMemo(
    () => fixtures.find((f) => f.fixtureId === fixtureId) ?? null,
    [fixtures, fixtureId],
  );

  // Only join once the fan has picked a side.
  const pulse = usePulse(team != null ? fixtureId : null, team ?? 0, name);

  // Keep the open card in sync as its verification streams in (pending → verified).
  const liveMoment = useMemo(
    () => (openMoment ? pulse.moments.find((m) => m.id === openMoment.id) ?? openMoment : null),
    [openMoment, pulse.moments],
  );

  // While scrubbing, resolve the emotional snapshot at the scrubbed instant so the
  // canvas relives it. Null when live.
  const override = useMemo(() => {
    const tl = pulse.timeline;
    if (scrub == null || tl.length < 2) return null;
    const t0 = tl[0].t;
    const t1 = tl[tl.length - 1].t;
    if (t1 <= t0) return null;
    const targetT = t0 + (t1 - t0) * scrub;
    let best = tl[0];
    for (const p of tl) if (Math.abs(p.t - targetT) < Math.abs(best.t - targetT)) best = p;
    return { intensity: best.i, tilt: best.tilt };
  }, [scrub, pulse.timeline]);

  // Re-fire a moment's eruption on the canvas as the scrub drags across it.
  useEffect(() => {
    const tl = pulse.timeline;
    if (scrub == null || tl.length < 2) {
      lastBurstId.current = null;
      return;
    }
    const t0 = tl[0].t;
    const t1 = tl[tl.length - 1].t;
    if (t1 <= t0) return;
    const targetT = t0 + (t1 - t0) * scrub;
    const tol = (t1 - t0) * 0.02;
    const near = pulse.moments.find((m) => Math.abs(m.ts - targetT) <= tol);
    if (near && near.id !== lastBurstId.current) {
      lastBurstId.current = near.id;
      setBurstEvent({
        id: `scrub-${near.id}-${Date.now()}`,
        fixtureId: near.fixtureId,
        type: near.eventType,
        team: near.team,
        seq: near.seq,
        statKey: near.statKey,
        minute: near.minute,
        label: near.label,
        intensity: Math.max(0.85, near.intensity),
        ts: Date.now(),
      });
    } else if (!near) {
      lastBurstId.current = null;
    }
  }, [scrub, pulse.timeline, pulse.moments]);

  if (team == null) {
    if (!entered) {
      return <Landing theme={theme} liveCount={fixtures.length} onEnter={() => setEntered(true)} />;
    }
    return (
      <Lobby
        fixtures={fixtures}
        selectedId={fixtureId}
        onSelect={setFixtureId}
        fixture={fixture}
        name={name}
        onName={setName}
        invited={invitedFixture != null && fixtureId === invitedFixture}
        onPick={(side) => setTeam(side)}
        themeId={theme.id}
        onTheme={setThemeId}
      />
    );
  }

  const inviteUrl = `${window.location.origin}${window.location.pathname}?join=${fixtureId}`;

  return (
    <div className="app">
      <EmotionCanvas
        emotion={pulse.emotion}
        lastEvent={pulse.lastEvent}
        homeColor={theme.home}
        awayColor={theme.away}
        bgColor={theme.bg}
        lightColor={theme.light}
        override={override}
        burstEvent={burstEvent}
      />
      <Floaters pops={pulse.pops} />

      <div className="overlay">
        <RoomHeader
          room={pulse.room}
          connected={pulse.connected}
          team={team}
          homeColor={theme.home}
          awayColor={theme.away}
          inviteUrl={inviteUrl}
        />

        <div className="moments-row">
          <MomentsRail moments={pulse.moments} onOpen={setOpenMoment} />
          <div className="moments-actions">
            <button
              className="theme-btn"
              onClick={() => setShowThemes((v) => !v)}
              title="Visual theme"
            >
              🎨 {theme.name}
            </button>
            <button className="verify-real-btn" onClick={verifyRealGoal} disabled={verifying}>
              {verifying ? "Verifying on Solana…" : "⛓ Verify a real goal on-chain"}
            </button>
          </div>
        </div>
        {showThemes && (
          <ThemePicker
            current={theme.id}
            compact
            onPick={(id) => {
              setThemeId(id);
              setShowThemes(false);
            }}
          />
        )}
        {verifyErr && <p className="verify-err">{verifyErr}</p>}

        <div className="spacer" />

        <TimelineRibbon
          timeline={pulse.timeline}
          moments={pulse.moments}
          scrub={scrub}
          onScrub={setScrub}
          onOpenMoment={setOpenMoment}
        />
        <EventTicker events={pulse.events} />
        <ReactionBar onReact={pulse.react} counts={pulse.emotion?.counts} />
      </div>

      {liveMoment && (
        <MomentCard
          moment={liveMoment}
          homeColor={theme.home}
          awayColor={theme.away}
          bgColor={theme.bg}
          onClose={() => setOpenMoment(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lobby — the matchday screen: pick a match, shout your name, pick your side.
// ---------------------------------------------------------------------------

interface LobbyProps {
  fixtures: FixtureSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  fixture: FixtureSummary | null;
  name: string;
  onName: (name: string) => void;
  invited: boolean;
  onPick: (side: Side) => void;
  themeId: string;
  onTheme: (id: string) => void;
}

function Lobby({ fixtures, selectedId, onSelect, fixture, name, onName, invited, onPick, themeId, onTheme }: LobbyProps) {
  const home = fixture?.participants[0] ?? "Home";
  const away = fixture?.participants[1] ?? "Away";

  return (
    <div className="lobby">
      <div className="pitch-bg" aria-hidden>
        <div className="pitch-line" />
        <div className="pitch-circle" />
      </div>

      <header className="lobby-brand">
        <h1 className="brand">PULSE</h1>
        <p className="tagline">Feel the match together</p>
      </header>

      {invited && (
        <div className="invite-banner">
          🎟 You've been invited to <strong>{home} vs {away}</strong>
        </div>
      )}

      {fixtures.length === 0 ? (
        <p className="lobby-status">Finding live matches…</p>
      ) : (
        <>
          <section className="matches">
            <h2 className="section-label">
              <span className="live-dot" /> Matchday · live now
            </h2>
            <div className="match-cards">
              {fixtures.map((f) => {
                const live = f.phase >= 2 && f.phase <= 13;
                return (
                  <button
                    key={f.fixtureId}
                    className={`match-card ${f.fixtureId === selectedId ? "selected" : ""}`}
                    onClick={() => onSelect(f.fixtureId)}
                  >
                    <span className="mc-team mc-home">{f.participants[0]}</span>
                    <span className="mc-score">
                      {f.score ? `${f.score[0]}–${f.score[1]}` : "VS"}
                    </span>
                    <span className="mc-team mc-away">{f.participants[1]}</span>
                    <span className="mc-phase">
                      {live && f.minute != null
                        ? `${f.minute}'`
                        : PHASE_LABEL[f.phase] ?? "Scheduled"}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="joinbox">
            <input
              className="name-input"
              placeholder="Your chant name (optional)"
              maxLength={18}
              value={name}
              onChange={(e) => onName(e.target.value)}
            />

            <div className="side-pick">
              <button
                className="side-panel home"
                style={{ ["--c" as string]: "var(--home)" }}
                onClick={() => onPick(1)}
              >
                <span className="sp-label">I'm with</span>
                <span className="sp-team">{home}</span>
              </button>
              <span className="vs-badge">VS</span>
              <button
                className="side-panel away"
                style={{ ["--c" as string]: "var(--away)" }}
                onClick={() => onPick(2)}
              >
                <span className="sp-label">I'm with</span>
                <span className="sp-team">{away}</span>
              </button>
            </div>

            <button className="neutral-btn" onClick={() => onPick(0)}>
              Just here for the vibes
            </button>
          </section>

          <section className="theme-section">
            <h2 className="section-label">🎨 Choose your look</h2>
            <ThemePicker current={themeId} onPick={onTheme} />
          </section>
        </>
      )}
    </div>
  );
}
