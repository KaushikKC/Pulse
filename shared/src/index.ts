/**
 * PULSE shared protocol — the single contract between the backend and the browser.
 *
 * Both the Node ingest/fan-out service and the React client import these types and
 * constants so the "machine truth" (live feed) and "human feeling" (reactions) stay
 * locked to the same vocabulary and the same timeline.
 */

// ---------------------------------------------------------------------------
// TxLINE soccer data model (subset we actually use)
// ---------------------------------------------------------------------------

/** Game phase IDs per the TxLINE soccer feed. */
export const GamePhase = {
  NotStarted: 1,
  FirstHalf: 2,
  HalfTime: 3,
  SecondHalf: 4,
  Ended: 5,
  WaitingExtraTime: 6,
  ExtraTime1: 7,
  HalfTimeExtraTime: 8,
  ExtraTime2: 9,
  FullExtraTime: 10,
  WaitingPenalties: 11,
  Penalties: 12,
  FullPenalties: 13,
  Interrupted: 14,
  Abandoned: 15,
  Cancelled: 16,
  Postponed: 19,
} as const;

export const PHASE_LABEL: Record<number, string> = {
  1: "Not started",
  2: "1st half",
  3: "Half time",
  4: "2nd half",
  5: "Full time",
  6: "Waiting ET",
  7: "ET 1st half",
  8: "ET half time",
  9: "ET 2nd half",
  10: "End of ET",
  11: "Waiting pens",
  12: "Penalties",
  13: "End of pens",
  14: "Interrupted",
  15: "Abandoned",
  16: "Cancelled",
  19: "Postponed",
};

/** Full-game stat keys. Period-specific keys add a period multiplier (H1 +1000 …). */
export const StatKey = {
  GoalsP1: 1,
  GoalsP2: 2,
  YellowP1: 3,
  YellowP2: 4,
  RedP1: 5,
  RedP2: 6,
  CornersP1: 7,
  CornersP2: 8,
} as const;

/** Which side (1 = home / participant 1, 2 = away / participant 2, 0 = neutral). */
export type Side = 0 | 1 | 2;

/**
 * Normalized raw score frame produced by either the live SSE ingest or the
 * simulator. The event detector diffs successive frames to derive events.
 */
export interface ScoreFrame {
  fixtureId: string;
  seq: number;
  phase: number;
  /** statKey -> current value (we only carry the keys we react to). */
  stats: Record<number, number>;
  participants: [string, string];
  /** Match minute if the feed exposes it. */
  minute?: number;
}

/** Normalized odds frame — implied probabilities for 1 / X / 2. */
export interface OddsFrame {
  fixtureId: string;
  seq: number;
  /** [home, draw, away] implied probability as percentages (0–100). */
  impliedProb: [number, number, number];
}

// ---------------------------------------------------------------------------
// Normalized match events (the "triggers")
// ---------------------------------------------------------------------------

export type MatchEventType =
  | "kickoff"
  | "goal"
  | "red_card"
  | "yellow_card"
  | "phase_change"
  | "momentum_swing"
  | "full_time";

export interface MatchEvent {
  id: string;
  fixtureId: string;
  type: MatchEventType;
  /** Side the event belongs to, when applicable. */
  team: Side;
  /** Feed sequence number — used later for on-chain stat validation. */
  seq: number;
  /** TxLINE stat key, when the event came from a stat increment. */
  statKey?: number;
  minute?: number;
  /** Human label rendered in the ticker. */
  label: string;
  /** 0..1 — how hard the visualization should spike. */
  intensity: number;
  ts: number;
}

// ---------------------------------------------------------------------------
// Human reactions + aggregated emotional state
// ---------------------------------------------------------------------------

export type ReactionType = "cheer" | "panic" | "rage" | "hype";

export const REACTIONS: ReactionType[] = ["cheer", "panic", "rage", "hype"];

/** Visual identity for each reaction (kept here so server + client agree). */
export const REACTION_META: Record<
  ReactionType,
  { emoji: string; label: string; color: string; weight: number }
> = {
  cheer: { emoji: "🎉", label: "Cheer", color: "#22d3a6", weight: 1 },
  hype: { emoji: "🔥", label: "Hype", color: "#f59e0b", weight: 1.2 },
  panic: { emoji: "😱", label: "Panic", color: "#3b82f6", weight: 1 },
  rage: { emoji: "🤬", label: "Rage", color: "#ef4444", weight: 1.3 },
};

export type ReactionCounts = Record<ReactionType, number>;

export function emptyCounts(): ReactionCounts {
  return { cheer: 0, panic: 0, rage: 0, hype: 0 };
}

/**
 * The fused "emotional state" of a room over the most recent aggregation window.
 * This is the heartbeat the canvas renders.
 */
export interface EmotionalState {
  fixtureId: string;
  windowMs: number;
  /** Total reaction counts this window. */
  counts: ReactionCounts;
  /** Counts split by the team the reacting fan supports (0 = neutral). */
  byTeam: Record<Side, ReactionCounts>;
  /** 0..1 smoothed overall intensity driving canvas energy. */
  intensity: number;
  /** -1 (away-leaning) … 0 … +1 (home-leaning) crowd tilt. */
  tilt: number;
  /** Active participants in the room. */
  present: number;
  ts: number;
}

// ---------------------------------------------------------------------------
// Lightweight room/fixture state pushed to clients on join
// ---------------------------------------------------------------------------

export interface RoomState {
  fixtureId: string;
  participants: [string, string];
  phase: number;
  score: [number, number];
  minute?: number;
  present: number;
}

// ---------------------------------------------------------------------------
// Socket.IO event contracts
// ---------------------------------------------------------------------------

export interface ClientToServer {
  join: (payload: { fixtureId: string; team: Side; name?: string }) => void;
  leave: (payload: { fixtureId: string }) => void;
  react: (payload: { fixtureId: string; type: ReactionType }) => void;
}

export interface ServerToClient {
  room_state: (state: RoomState) => void;
  match_event: (event: MatchEvent) => void;
  emotion: (state: EmotionalState) => void;
  /** Echo a single reaction immediately for snappy local feedback / floaters. */
  reaction_pop: (payload: { type: ReactionType; team: Side }) => void;
}

/** Fixtures available to join (from /api/fixtures/snapshot or the simulator). */
export interface FixtureSummary {
  fixtureId: string;
  participants: [string, string];
  phase: number;
  live: boolean;
}

export const AGGREGATION_WINDOW_MS = 250;
