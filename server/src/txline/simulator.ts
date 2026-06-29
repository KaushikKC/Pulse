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
 * at judging." This drives a scripted but believable match through the EXACT same
 * detector → bus → fan-out path as the live feed, so the demo always looks alive.
 * It also emits low-level odds drift so momentum swings fire naturally.
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

const FIXTURE_ID = "sim-arg-fra";

function makeFixture(): SimFixture {
  return {
    fixtureId: FIXTURE_ID,
    participants: ["Argentina", "France"],
    phase: GamePhase.NotStarted,
    stats: {
      [StatKey.GoalsP1]: 0,
      [StatKey.GoalsP2]: 0,
      [StatKey.YellowP1]: 0,
      [StatKey.YellowP2]: 0,
      [StatKey.RedP1]: 0,
      [StatKey.RedP2]: 0,
    },
    impliedProb: [40, 28, 32],
    minute: 0,
    seq: 0,
  };
}

/**
 * A compressed, dramatic match timeline (~2.5 min of wall-clock for a snappy demo
 * loop). Mirrors a real WC final's emotional shape: early goal, momentum, red card,
 * late equaliser, penalties.
 */
const SCRIPT: ScriptItem[] = [
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
];

const LOOP_SECONDS = 170;

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

export class Simulator {
  private fixture = makeFixture();
  private elapsed = 0;
  private fired = new Set<number>();
  private timer?: NodeJS.Timeout;

  fixtures(): FixtureSummary[] {
    return [
      {
        fixtureId: FIXTURE_ID,
        participants: this.fixture.participants,
        phase: this.fixture.phase,
        live: true,
      },
    ];
  }

  start(): void {
    console.log("[sim] starting simulated World Cup feed (Argentina vs France)");
    // Tick 4×/sec: pushes odds drift + advances the scripted timeline.
    this.timer = setInterval(() => this.tick(0.25), 250);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private tick(dt: number): void {
    this.elapsed += dt;

    // Loop the match so a demo recorded any time looks live.
    if (this.elapsed >= LOOP_SECONDS) {
      this.elapsed = 0;
      this.fired.clear();
      this.fixture = makeFixture();
    }

    // Fire any script items whose time has arrived.
    for (let i = 0; i < SCRIPT.length; i++) {
      if (!this.fired.has(i) && this.elapsed >= SCRIPT[i].at) {
        this.fired.add(i);
        SCRIPT[i].apply(this.fixture);
        this.emitScore();
      }
    }

    // Continuous gentle odds wander so the momentum detector stays alive.
    if (Math.random() < 0.25) {
      nudgeOdds(this.fixture, (Math.random() - 0.5) * 2.5);
      this.emitOdds();
    }

    // Advance the displayed match minute during live phases.
    if (
      this.fixture.phase === GamePhase.FirstHalf ||
      this.fixture.phase === GamePhase.SecondHalf
    ) {
      this.fixture.minute = Math.min(90, Math.round((this.elapsed / LOOP_SECONDS) * 90));
    }
  }

  private emitScore(): void {
    const f = this.fixture;
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

  private emitOdds(): void {
    const f = this.fixture;
    f.seq += 1;
    const frame: OddsFrame = {
      fixtureId: f.fixtureId,
      seq: f.seq,
      impliedProb: f.impliedProb,
    };
    bus.emit("odds_frame", frame);
  }
}
