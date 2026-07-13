import { EventEmitter } from "node:events";
import type {
  MatchEvent,
  ScoreFrame,
  OddsFrame,
  RoomState,
  VerifiedMoment,
} from "@pulse/shared";

/**
 * In-memory event bus (the doc's stated MVP choice — swap for Redis pub/sub to
 * scale horizontally later). It decouples the ingest/detector from the fan-out
 * layer: ingest publishes frames + events, the room service subscribes.
 */
type BusEvents = {
  score_frame: (frame: ScoreFrame) => void;
  odds_frame: (frame: OddsFrame) => void;
  match_event: (event: MatchEvent) => void;
  /** Authoritative room/fixture state changes (score, phase, minute). */
  room_state: (state: RoomState) => void;
  /** A collectible moment was captured (verification may still be pending). */
  verified_moment: (moment: VerifiedMoment) => void;
};

class TypedBus {
  private emitter = new EventEmitter();

  constructor() {
    // A frozen feed is the worst demo outcome; never let a stray listener crash us.
    this.emitter.setMaxListeners(50);
  }

  on<K extends keyof BusEvents>(event: K, listener: BusEvents[K]): void {
    this.emitter.on(event, listener as (...args: unknown[]) => void);
  }

  emit<K extends keyof BusEvents>(
    event: K,
    ...args: Parameters<BusEvents[K]>
  ): void {
    this.emitter.emit(event, ...args);
  }
}

export const bus = new TypedBus();
