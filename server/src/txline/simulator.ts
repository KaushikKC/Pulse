import {
  GamePhase,
  StatKey,
  type FixtureSummary,
  type OddsFrame,
  type ScoreFrame,
} from "@pulse/shared";
import { bus } from "../bus.js";

/**
 * Simulated crowd / replay feed.
 *
 * Risk mitigation from the architecture: "Together needs a crowd; none guaranteed
 * at judging." This drives scripted but believable matches through the EXACT same
 * detector → bus → fan-out path as the live feed, so the demo always looks alive.
 * It also emits low-level odds drift so momentum swings fire naturally.
 *
 * Runs SEVERAL concurrent fixtures (offset in time so they're never in sync) —
 * the lobby becomes a real matchday card picker, not a single hardcoded room.
 */

interface ScriptItem {
  /** Seconds into the sim when this happens. */
  at: number;
  apply: (s: SimFixture) => void;
}

interface SimFixture {
  fixtureId: string;
  participants: [string, string];
  phase: number;
  stats: Record<number, number>;
  impliedProb: [number, number, number];
  minute: number;
  seq: number;
}

interface SimDef {
  fixtureId: string;
  participants: [string, string];
  impliedProb: [number, number, number];
  script: ScriptItem[];
  loopSeconds: number;
  /** Start partway through the loop so concurrent matches never sync up. */
  offset: number;
}

function makeFixture(def: SimDef): SimFixture {
  return {
    fixtureId: def.fixtureId,
    participants: def.participants,
    phase: GamePhase.NotStarted,
    stats: {
      [StatKey.GoalsP1]: 0,
      [StatKey.GoalsP2]: 0,
      [StatKey.YellowP1]: 0,
      [StatKey.YellowP2]: 0,
      [StatKey.RedP1]: 0,
      [StatKey.RedP2]: 0,
    },
    impliedProb: def.impliedProb,
    minute: 0,
    seq: 0,
  };
}

/**
 * Three compressed, dramatic match timelines (~2.5 min of wall-clock each for a
 * snappy demo loop). Each mirrors a different emotional shape: the chaotic final,
 * the comeback with a red card, the tight late winner.
 */
const DEFS: SimDef[] = [
  {
    fixtureId: "sim-arg-fra",
    participants: ["Argentina", "France"],
    impliedProb: [40, 28, 32],
    loopSeconds: 170,
    offset: 0,
    script: [
      { at: 2, apply: (s) => (s.phase = GamePhase.FirstHalf) },
      { at: 14, apply: (s) => bump(s, StatKey.GoalsP1) }, // Argentina goal
      { at: 26, apply: (s) => bump(s, StatKey.YellowP2) },
      { at: 40, apply: (s) => bump(s, StatKey.GoalsP1) }, // 2-0
      { at: 58, apply: (s) => (s.phase = GamePhase.HalfTime) },
      { at: 64, apply: (s) => (s.phase = GamePhase.SecondHalf) },
      { at: 78, apply: (s) => bump(s, StatKey.GoalsP2) }, // France pull one back
      { at: 90, apply: (s) => bump(s, StatKey.RedP1) }, // Argentina red card
      { at: 104, apply: (s) => bump(s, StatKey.GoalsP2) }, // 2-2 late drama
      { at: 118, apply: (s) => (s.phase = GamePhase.WaitingPenalties) },
      { at: 124, apply: (s) => (s.phase = GamePhase.Penalties) },
      { at: 150, apply: (s) => bump(s, StatKey.GoalsP1) }, // shootout decided
      { at: 156, apply: (s) => (s.phase = GamePhase.FullPenalties) },
    ],
  },
  {
    fixtureId: "sim-bra-ger",
    participants: ["Brazil", "Germany"],
    impliedProb: [44, 26, 30],
    loopSeconds: 155,
    offset: 45,
    script: [
      { at: 2, apply: (s) => (s.phase = GamePhase.FirstHalf) },
      { at: 18, apply: (s) => bump(s, StatKey.GoalsP1) }, // Brazil strike early
      { at: 34, apply: (s) => bump(s, StatKey.YellowP1) },
      { at: 50, apply: (s) => bump(s, StatKey.RedP2) }, // Germany down to ten
      { at: 66, apply: (s) => (s.phase = GamePhase.HalfTime) },
      { at: 72, apply: (s) => (s.phase = GamePhase.SecondHalf) },
      { at: 88, apply: (s) => bump(s, StatKey.GoalsP2) }, // ten-man equaliser
      { at: 108, apply: (s) => bump(s, StatKey.GoalsP1) }, // Brazil retake it
      { at: 126, apply: (s) => bump(s, StatKey.GoalsP1) }, // and seal it
      { at: 142, apply: (s) => (s.phase = GamePhase.Ended) },
    ],
  },
  {
    fixtureId: "sim-esp-eng",
    participants: ["Spain", "England"],
    impliedProb: [36, 30, 34],
    loopSeconds: 160,
    offset: 95,
    script: [
      { at: 2, apply: (s) => (s.phase = GamePhase.FirstHalf) },
      { at: 20, apply: (s) => bump(s, StatKey.YellowP2) },
      { at: 38, apply: (s) => bump(s, StatKey.YellowP1) },
      { at: 56, apply: (s) => (s.phase = GamePhase.HalfTime) },
      { at: 62, apply: (s) => (s.phase = GamePhase.SecondHalf) },
      { at: 84, apply: (s) => bump(s, StatKey.GoalsP2) }, // England ahead
      { at: 104, apply: (s) => bump(s, StatKey.GoalsP1) }, // Spain level
      { at: 126, apply: (s) => bump(s, StatKey.GoalsP1) }, // 90'+ winner
      { at: 144, apply: (s) => (s.phase = GamePhase.Ended) },
    ],
  },
];

function bump(s: SimFixture, key: number): void {
  s.stats[key] = (s.stats[key] ?? 0) + 1;
  // Shift the odds toward whoever just scored, so momentum swings can fire too.
  if (key === StatKey.GoalsP1) nudgeOdds(s, +8);
  if (key === StatKey.GoalsP2) nudgeOdds(s, -8);
  if (key === StatKey.RedP1) nudgeOdds(s, -6);
  if (key === StatKey.RedP2) nudgeOdds(s, +6);
}

function nudgeOdds(s: SimFixture, homeDelta: number): void {
  const [h, d, a] = s.impliedProb;
  const nh = clamp(h + homeDelta, 5, 90);
  const na = clamp(a - homeDelta, 5, 90);
  const nd = clamp(100 - nh - na, 2, 60);
  s.impliedProb = normalize([nh, nd, na]);
}

function normalize([a, b, c]: number[]): [number, number, number] {
  const sum = a + b + c || 1;
  return [(a / sum) * 100, (b / sum) * 100, (c / sum) * 100];
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

interface SimState {
  def: SimDef;
  fixture: SimFixture;
  elapsed: number;
  fired: Set<number>;
}

export class Simulator {
  private matches: SimState[] = DEFS.map((def) => ({
    def,
    fixture: makeFixture(def),
    elapsed: def.offset,
    fired: prefire(def),
  }));
  private timer?: NodeJS.Timeout;

  fixtures(): FixtureSummary[] {
    return this.matches.map((m) => ({
      fixtureId: m.def.fixtureId,
      participants: m.def.participants,
      phase: m.fixture.phase,
      live: true,
    }));
  }

  start(): void {
    console.log(`[sim] starting simulated World Cup matchday (${DEFS.length} fixtures)`);
    // Catch each fixture up to its offset so the lobby shows mid-match scores.
    // Deferred a tick so every downstream bus listener is wired up first.
    setImmediate(() => {
      for (const m of this.matches) {
        for (const i of m.fired) m.def.script[i].apply(m.fixture);
        this.emitScore(m);
      }
    });
    // Tick 4×/sec: pushes odds drift + advances the scripted timelines.
    this.timer = setInterval(() => {
      for (const m of this.matches) this.tick(m, 0.25);
    }, 250);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private tick(m: SimState, dt: number): void {
    m.elapsed += dt;

    // Loop the match so a demo recorded any time looks live.
    if (m.elapsed >= m.def.loopSeconds) {
      m.elapsed = 0;
      m.fired.clear();
      m.fixture = makeFixture(m.def);
    }

    // Fire any script items whose time has arrived.
    for (let i = 0; i < m.def.script.length; i++) {
      if (!m.fired.has(i) && m.elapsed >= m.def.script[i].at) {
        m.fired.add(i);
        m.def.script[i].apply(m.fixture);
        this.emitScore(m);
      }
    }

    // Continuous gentle odds wander so the momentum detector stays alive.
    if (Math.random() < 0.25) {
      nudgeOdds(m.fixture, (Math.random() - 0.5) * 2.5);
      this.emitOdds(m);
    }

    // Advance the displayed match minute during live phases.
    if (
      m.fixture.phase === GamePhase.FirstHalf ||
      m.fixture.phase === GamePhase.SecondHalf
    ) {
      m.fixture.minute = Math.min(90, Math.round((m.elapsed / m.def.loopSeconds) * 90));
    }
  }

  private emitScore(m: SimState): void {
    const f = m.fixture;
    f.seq += 1;
    const frame: ScoreFrame = {
      fixtureId: f.fixtureId,
      seq: f.seq,
      phase: f.phase,
      stats: { ...f.stats },
      participants: f.participants,
      minute: f.minute,
    };
    bus.emit("score_frame", frame);
  }

  private emitOdds(m: SimState): void {
    const f = m.fixture;
    f.seq += 1;
    const frame: OddsFrame = {
      fixtureId: f.fixtureId,
      seq: f.seq,
      impliedProb: f.impliedProb,
    };
    bus.emit("odds_frame", frame);
  }
}

/** Which script items are already in the past at a fixture's start offset. */
function prefire(def: SimDef): Set<number> {
  const fired = new Set<number>();
  def.script.forEach((item, i) => {
    if (item.at <= def.offset) fired.add(i);
  });
  return fired;
}
