import {
  GamePhase,
  StatKey,
  type FixtureSummary,
  type OddsFrame,
  type ScoreFrame,
} from "@pulse/shared";
import { bus } from "../bus.js";
import { config } from "../config.js";

/**
 * Verified-replay feed — the honest bridge between "lively" and "real".
 *
 * The simulator is lively but fabricated: its goals have no Merkle proof, so its
 * moments can only be marked "unverified". The live devnet feed is real but empty
 * (fixtures are only scheduled). This mode gives you BOTH: it replays a REAL past
 * fixture (config.replay.fixtureId) scripted with that match's REAL milestones —
 * each goal / red card carries the actual feed `(seq, statKey)` whose Merkle proof
 * validates against TxLINE's daily-scores root on Solana.
 *
 * The tuples below were discovered from the fixture's `/api/scores/snapshot`
 * timeline and each was confirmed `valid:true` on devnet. Every captured moment in
 * this mode therefore auto-verifies on-chain for real — the moments rail fills with
 * genuinely provable collectibles from the match you're watching.
 *
 * It drives the EXACT same detector → bus → fan-out path as the other feeds; only
 * the origin of the frames differs (architecture's one-connection-in rule).
 */

interface Beat {
  /** Seconds into the compressed replay when this happens. */
  at: number;
  /** Displayed match minute (from the real match clock). */
  minute?: number;
  phase?: number;
  /** Increment a stat (the detector diffs this into a goal/red/yellow event). */
  bump?: number;
  /** Real feed (seq, statKey) proving this beat's milestone on-chain. */
  proof?: { seq: number; statKey: number };
  /** Odds nudge toward home (+) / away (−) so momentum swings fire too. */
  odds?: number;
}

/**
 * Real fixture 17952170 — a genuine 1–1 draw. Real, on-chain-verified milestones:
 *   26'  away goal        → proof (260, 1002)   ✅ valid on devnet
 *   61'  away red card    → proof (653, 3006)   ✅ valid on devnet
 *   65'  home equaliser   → proof (687, 3001)   ✅ valid on devnet
 * Compressed to a snappy ~85s loop so a demo recorded any time looks live.
 */
const SCRIPT: Beat[] = [
  { at: 2, phase: GamePhase.FirstHalf, minute: 1 },
  { at: 16, minute: 26, bump: StatKey.GoalsP2, proof: { seq: 260, statKey: 1002 }, odds: -9 }, // 0–1 away
  { at: 30, phase: GamePhase.HalfTime, minute: 45 },
  { at: 36, phase: GamePhase.SecondHalf, minute: 46 },
  { at: 48, minute: 61, bump: StatKey.RedP2, proof: { seq: 653, statKey: 3006 }, odds: +7 }, // away down to 10
  { at: 58, minute: 65, bump: StatKey.GoalsP1, proof: { seq: 687, statKey: 3001 }, odds: +9 }, // 1–1 equaliser
  { at: 74, phase: GamePhase.Ended, minute: 90 }, // full time 1–1
];

const LOOP_SECONDS = 85;

interface State {
  phase: number;
  minute: number;
  stats: Record<number, number>;
  impliedProb: [number, number, number];
  seq: number;
}

function freshState(): State {
  return {
    phase: GamePhase.NotStarted,
    minute: 0,
    stats: {
      [StatKey.GoalsP1]: 0,
      [StatKey.GoalsP2]: 0,
      [StatKey.YellowP1]: 0,
      [StatKey.YellowP2]: 0,
      [StatKey.RedP1]: 0,
      [StatKey.RedP2]: 0,
    },
    impliedProb: [42, 28, 30],
    seq: 0,
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export class Replay {
  private state = freshState();
  private elapsed = 0;
  private fired = new Set<number>();
  private timer?: NodeJS.Timeout;

  private get participants(): [string, string] {
    return [config.replay.home, config.replay.away];
  }

  fixtures(): FixtureSummary[] {
    return [
      {
        fixtureId: config.replay.fixtureId,
        participants: this.participants,
        phase: this.state.phase,
        live: true,
      },
    ];
  }

  start(): void {
    console.log(
      `[replay] verified replay of real fixture ${config.replay.fixtureId} ` +
        "(every milestone proves on-chain)",
    );
    // Emit a baseline frame once listeners are wired, then tick the timeline.
    setImmediate(() => this.emitScore());
    this.timer = setInterval(() => this.tick(0.25), 250);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private tick(dt: number): void {
    this.elapsed += dt;
    if (this.elapsed >= LOOP_SECONDS) {
      this.elapsed = 0;
      this.fired.clear();
      this.state = freshState();
      this.emitScore();
    }

    for (let i = 0; i < SCRIPT.length; i++) {
      const beat = SCRIPT[i];
      if (this.fired.has(i) || this.elapsed < beat.at) continue;
      this.fired.add(i);
      if (beat.phase != null) this.state.phase = beat.phase;
      if (beat.minute != null) this.state.minute = beat.minute;
      if (beat.bump != null) this.state.stats[beat.bump] = (this.state.stats[beat.bump] ?? 0) + 1;
      if (beat.odds != null) this.nudgeOdds(beat.odds);
      this.emitScore(beat.proof);
    }

    // Gentle continuous odds wander so the momentum detector stays alive.
    if (Math.random() < 0.25) {
      this.nudgeOdds((Math.random() - 0.5) * 2.5);
      this.emitOdds();
    }
  }

  private nudgeOdds(homeDelta: number): void {
    const [h, d, a] = this.state.impliedProb;
    const nh = clamp(h + homeDelta, 5, 90);
    const na = clamp(a - homeDelta, 5, 90);
    const nd = clamp(100 - nh - na, 2, 60);
    const sum = nh + nd + na || 1;
    this.state.impliedProb = [(nh / sum) * 100, (nd / sum) * 100, (na / sum) * 100];
  }

  private emitScore(proof?: { seq: number; statKey: number }): void {
    this.state.seq += 1;
    const frame: ScoreFrame = {
      fixtureId: config.replay.fixtureId,
      seq: this.state.seq,
      phase: this.state.phase,
      stats: { ...this.state.stats },
      participants: this.participants,
      minute: this.state.minute,
      proof,
    };
    bus.emit("score_frame", frame);
  }

  private emitOdds(): void {
    this.state.seq += 1;
    const frame: OddsFrame = {
      fixtureId: config.replay.fixtureId,
      seq: this.state.seq,
      impliedProb: this.state.impliedProb,
    };
    bus.emit("odds_frame", frame);
  }
}
