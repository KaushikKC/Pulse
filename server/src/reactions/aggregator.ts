import {
  REACTION_META,
  emptyCounts,
  type EmotionalState,
  type ReactionCounts,
  type ReactionType,
  type Side,
} from "@pulse/shared";

/**
 * Reaction aggregator. Fans tap a lot; we do NOT broadcast every tap. Instead we
 * accumulate into a fixed window (~250ms), then emit one fused "emotional state"
 * per room — the heartbeat the canvas renders. This windowed aggregation is the
 * complexity judges can *feel*: the screen pulses with the crowd's mood.
 *
 * Intensity is smoothed across windows so the canvas eases instead of strobing.
 */
interface Bucket {
  byTeam: Record<Side, ReactionCounts>;
  total: ReactionCounts;
}

function freshBucket(): Bucket {
  return {
    byTeam: { 0: emptyCounts(), 1: emptyCounts(), 2: emptyCounts() },
    total: emptyCounts(),
  };
}

export class ReactionAggregator {
  private buckets = new Map<string, Bucket>();
  private intensity = new Map<string, number>();
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly windowMs: number,
    private readonly onState: (state: EmotionalState) => void,
    private readonly presenceOf: (fixtureId: string) => number,
  ) {}

  start(): void {
    this.timer = setInterval(() => this.flush(), this.windowMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Record a single reaction into the current window. */
  add(fixtureId: string, type: ReactionType, team: Side): void {
    let b = this.buckets.get(fixtureId);
    if (!b) {
      b = freshBucket();
      this.buckets.set(fixtureId, b);
    }
    b.total[type] += 1;
    b.byTeam[team][type] += 1;
  }

  /** Inject energy from a match event so the canvas spikes on a real goal. */
  spike(fixtureId: string, amount: number): void {
    const cur = this.intensity.get(fixtureId) ?? 0;
    this.intensity.set(fixtureId, Math.min(1, cur + amount));
  }

  private flush(): void {
    // Emit for every fixture that has presence OR pending reactions, so an empty
    // room still gets a calm "breathing" heartbeat instead of going dark.
    const fixtures = new Set<string>(this.buckets.keys());
    for (const f of this.activeFixtures()) fixtures.add(f);

    for (const fixtureId of fixtures) {
      const b = this.buckets.get(fixtureId) ?? freshBucket();
      this.buckets.delete(fixtureId);

      const present = this.presenceOf(fixtureId);
      const raw = weightedTotal(b.total);

      // Decay previous intensity, then add this window's reaction energy.
      const prev = this.intensity.get(fixtureId) ?? 0;
      const reactionEnergy = Math.min(0.6, raw / Math.max(6, present * 2 || 6));
      const next = clamp01(prev * 0.82 + reactionEnergy);
      this.intensity.set(fixtureId, next);

      this.onState({
        fixtureId,
        windowMs: this.windowMs,
        counts: b.total,
        byTeam: b.byTeam,
        intensity: next,
        tilt: computeTilt(b.byTeam),
        present,
        ts: Date.now(),
      });
    }
  }

  private activeFixtures(): string[] {
    return [...this.intensity.keys()];
  }
}

function weightedTotal(counts: ReactionCounts): number {
  let sum = 0;
  for (const t of Object.keys(counts) as ReactionType[]) {
    sum += counts[t] * REACTION_META[t].weight;
  }
  return sum;
}

/** Crowd tilt: +1 fully home-leaning, -1 fully away-leaning. */
function computeTilt(byTeam: Record<Side, ReactionCounts>): number {
  const home = sum(byTeam[1]);
  const away = sum(byTeam[2]);
  const denom = home + away;
  if (denom === 0) return 0;
  return (home - away) / denom;
}

const sum = (c: ReactionCounts) => c.cheer + c.panic + c.rage + c.hype;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
