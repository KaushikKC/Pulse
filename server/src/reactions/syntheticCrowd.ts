import {
  REACTIONS,
  type MatchEvent,
  type ReactionType,
  type Side,
} from "@pulse/shared";
import type { ReactionAggregator } from "./aggregator.js";

/**
 * Synthetic crowd — directly mitigates the top risk in the architecture: a solo
 * judge opening the app to an empty room. It injects believable background
 * reactions and bursts hard on real match events, so PULSE always feels populated.
 *
 * It feeds the SAME aggregator a real fan would, so simulated and real reactions
 * are indistinguishable downstream.
 */
export class SyntheticCrowd {
  private timer?: NodeJS.Timeout;
  /** Per-fixture extra excitement that decays over time (set by match events). */
  private excitement = new Map<string, number>();

  constructor(
    private readonly aggregator: ReactionAggregator,
    private readonly fixtureIds: () => string[],
    /** Only animate rooms someone is actually watching (0 = animate all). */
    private readonly presenceOf: (fixtureId: string) => number = () => 1,
  ) {}

  start(): void {
    // 5×/sec we sprinkle ambient reactions scaled by current excitement.
    this.timer = setInterval(() => this.tick(), 200);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** A real event happened — make the crowd erupt with the right emotion. */
  onMatchEvent(event: MatchEvent): void {
    const boost = 0.5 + event.intensity;
    this.excitement.set(event.fixtureId, Math.min(3, (this.excitement.get(event.fixtureId) ?? 0) + boost));

    const burst = Math.round(8 + event.intensity * 40);
    for (let i = 0; i < burst; i++) {
      const { type, team } = this.reactionFor(event);
      this.aggregator.add(event.fixtureId, type, team);
    }
    this.aggregator.spike(event.fixtureId, Math.min(1, event.intensity));
  }

  private tick(): void {
    for (const fixtureId of this.fixtureIds()) {
      // Skip rooms nobody is in, so live mode doesn't animate 19 idle fixtures.
      if (this.presenceOf(fixtureId) === 0) {
        this.excitement.set(fixtureId, (this.excitement.get(fixtureId) ?? 0) * 0.9);
        continue;
      }
      const ex = this.excitement.get(fixtureId) ?? 0;
      // Light ambient chatter at idle (room feels alive but calm); excitement
      // from real events scales it up so goals stand out as genuine spikes.
      const taps = Math.round(ex * 12) + (Math.random() < 0.45 ? 1 : 0);
      for (let i = 0; i < taps; i++) {
        const team: Side = Math.random() < 0.5 ? 1 : 2;
        const type = REACTIONS[Math.floor(Math.random() * REACTIONS.length)];
        this.aggregator.add(fixtureId, type, team);
      }
      // Excitement cools off.
      this.excitement.set(fixtureId, ex * 0.9);
    }
  }

  /** Pick a reaction + leaning that matches the kind of event. */
  private reactionFor(event: MatchEvent): { type: ReactionType; team: Side } {
    const scoringSide = event.team;
    switch (event.type) {
      case "goal": {
        // Scoring fans cheer/hype; opposing fans panic/rage.
        const forScorer = Math.random() < 0.6;
        const team: Side = forScorer ? scoringSide : other(scoringSide);
        const type: ReactionType = forScorer
          ? Math.random() < 0.5 ? "cheer" : "hype"
          : Math.random() < 0.5 ? "panic" : "rage";
        return { type, team };
      }
      case "red_card":
        return { type: Math.random() < 0.5 ? "rage" : "panic", team: pickSide() };
      case "momentum_swing":
        return { type: "hype", team: scoringSide || pickSide() };
      case "full_time":
        return { type: "cheer", team: pickSide() };
      default:
        return { type: REACTIONS[Math.floor(Math.random() * REACTIONS.length)], team: pickSide() };
    }
  }
}

const other = (s: Side): Side => (s === 1 ? 2 : s === 2 ? 1 : pickSide());
const pickSide = (): Side => (Math.random() < 0.5 ? 1 : 2);
