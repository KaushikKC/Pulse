import { randomUUID } from "node:crypto";
import {
  GamePhase,
  PHASE_LABEL,
  StatKey,
  type MatchEvent,
  type MatchEventType,
  type OddsFrame,
  type RoomState,
  type ScoreFrame,
  type Side,
} from "@pulse/shared";
import { bus } from "../bus.js";

interface FixtureState {
  participants: [string, string];
  phase: number;
  stats: Record<number, number>;
  impliedProb: [number, number, number] | null;
  minute?: number;
}

/** Momentum-swing threshold in implied-probability points (doc suggests ≥5). */
const MOMENTUM_THRESHOLD = 5;

/**
 * The event detector keeps last-known state per fixture and turns raw feed frames
 * into normalized "triggers" — the same triggers that (a) spike the canvas and
 * (b) prompt the room to react. Pure diff logic; works identically for the live
 * SSE feed and the simulator.
 */
class EventDetector {
  private fixtures = new Map<string, FixtureState>();

  start(): void {
    bus.on("score_frame", (frame) => this.onScore(frame));
    bus.on("odds_frame", (frame) => this.onOdds(frame));
  }

  getRoomState(fixtureId: string): RoomState | null {
    const s = this.fixtures.get(fixtureId);
    if (!s) return null;
    return this.toRoomState(fixtureId, s, 0);
  }

  private onScore(frame: ScoreFrame): void {
    const prev = this.fixtures.get(frame.fixtureId);
    const next: FixtureState = {
      participants: frame.participants,
      phase: frame.phase,
      stats: { ...frame.stats },
      impliedProb: prev?.impliedProb ?? null,
      minute: frame.minute ?? prev?.minute,
    };

    if (!prev) {
      // First frame — establish baseline, announce kickoff if already underway.
      this.fixtures.set(frame.fixtureId, next);
      if (frame.phase === GamePhase.FirstHalf) {
        this.emit(frame, "kickoff", 0, "Kick-off", 0.5);
      }
      bus.emit("room_state", this.toRoomState(frame.fixtureId, next, 0));
      return;
    }

    // Goals: stat keys 1 (home) / 2 (away).
    this.diffStat(prev, next, frame, StatKey.GoalsP1, 1, "goal", (t) => `GOAL — ${frame.participants[0]}`, 1);
    this.diffStat(prev, next, frame, StatKey.GoalsP2, 2, "goal", () => `GOAL — ${frame.participants[1]}`, 1);

    // Red cards: keys 5 / 6.
    this.diffStat(prev, next, frame, StatKey.RedP1, 1, "red_card", () => `RED CARD — ${frame.participants[0]}`, 0.85);
    this.diffStat(prev, next, frame, StatKey.RedP2, 2, "red_card", () => `RED CARD — ${frame.participants[1]}`, 0.85);

    // Yellow cards: keys 3 / 4 (lighter spike).
    this.diffStat(prev, next, frame, StatKey.YellowP1, 1, "yellow_card", () => `Yellow — ${frame.participants[0]}`, 0.35);
    this.diffStat(prev, next, frame, StatKey.YellowP2, 2, "yellow_card", () => `Yellow — ${frame.participants[1]}`, 0.35);

    // Phase transitions (esp. ended / penalties).
    if (frame.phase !== prev.phase) {
      const ended =
        frame.phase === GamePhase.Ended ||
        frame.phase === GamePhase.FullExtraTime ||
        frame.phase === GamePhase.FullPenalties;
      const type: MatchEventType = ended ? "full_time" : "phase_change";
      const intensity = ended ? 0.9 : frame.phase === GamePhase.Penalties ? 0.8 : 0.4;
      this.emit(frame, type, 0, PHASE_LABEL[frame.phase] ?? `Phase ${frame.phase}`, intensity);
    }

    this.fixtures.set(frame.fixtureId, next);
    bus.emit("room_state", this.toRoomState(frame.fixtureId, next, 0));
  }

  private onOdds(frame: OddsFrame): void {
    const s = this.fixtures.get(frame.fixtureId);
    if (!s) {
      // Odds can arrive before scores; seed a minimal state so we don't drop it.
      this.fixtures.set(frame.fixtureId, {
        participants: ["Home", "Away"],
        phase: GamePhase.NotStarted,
        stats: {},
        impliedProb: frame.impliedProb,
      });
      return;
    }

    const prev = s.impliedProb;
    s.impliedProb = frame.impliedProb;
    if (!prev) return;

    // Momentum swing = home implied-prob move past the threshold.
    const delta = frame.impliedProb[0] - prev[0];
    if (Math.abs(delta) >= MOMENTUM_THRESHOLD) {
      const team: Side = delta > 0 ? 1 : 2;
      const who = delta > 0 ? s.participants[0] : s.participants[1];
      this.emit(
        { fixtureId: frame.fixtureId, seq: frame.seq, minute: s.minute } as ScoreFrame,
        "momentum_swing",
        team,
        `Momentum → ${who} (${delta > 0 ? "+" : ""}${delta.toFixed(0)} pts)`,
        Math.min(0.7, 0.3 + Math.abs(delta) / 30),
      );
    }
  }

  private diffStat(
    prev: FixtureState,
    next: FixtureState,
    frame: ScoreFrame,
    statKey: number,
    team: Side,
    type: MatchEventType,
    label: (team: Side) => string,
    intensity: number,
  ): void {
    const before = prev.stats[statKey] ?? 0;
    const after = next.stats[statKey] ?? 0;
    if (after > before) {
      this.emit(frame, type, team, label(team), intensity, statKey);
    }
  }

  private emit(
    frame: ScoreFrame,
    type: MatchEventType,
    team: Side,
    label: string,
    intensity: number,
    statKey?: number,
  ): void {
    const event: MatchEvent = {
      id: randomUUID(),
      fixtureId: frame.fixtureId,
      type,
      team,
      seq: frame.seq,
      statKey,
      minute: frame.minute,
      label,
      intensity,
      ts: Date.now(),
    };
    bus.emit("match_event", event);
  }

  private toRoomState(fixtureId: string, s: FixtureState, present: number): RoomState {
    return {
      fixtureId,
      participants: s.participants,
      phase: s.phase,
      score: [s.stats[StatKey.GoalsP1] ?? 0, s.stats[StatKey.GoalsP2] ?? 0],
      minute: s.minute,
      present,
    };
  }
}

export const detector = new EventDetector();
