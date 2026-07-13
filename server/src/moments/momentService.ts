import { randomUUID } from "node:crypto";
import {
  emptyCounts,
  type EmotionalState,
  type MatchEvent,
  type MatchEventType,
  type MomentVerification,
  type ReactionCounts,
  type ReactionType,
  type VerifiedMoment,
} from "@pulse/shared";
import { bus } from "../bus.js";
import { config } from "../config.js";
import { detector } from "../events/detector.js";
import { hasLiveToken, validateStatOnChain, fetchStatProof, explorerUrl } from "../txline/validation.js";

/**
 * Moment service — Stage 3, the "verified moment" layer.
 *
 * It listens for the milestone match events (goal / red card / full time) and,
 * when one fires, snapshots the room's *emotional peak* around that instant. The
 * result is a collectible `VerifiedMoment`: machine truth (the on-pitch stat) +
 * human feeling (the crowd's intensity), locked to the same timeline.
 *
 * If a live TxLINE token is present it then anchors the moment on-chain: fetch
 * the stat's Merkle proof and validate it against the daily-scores root on
 * Solana (see validation.ts). In simulator mode there is no real proof, so the
 * moment is captured but honestly marked "unverified" — we never fake a
 * cryptographic claim.
 */

/**
 * Events worth minting a moment for. Only stat-backed milestones (goals, red
 * cards) — these carry a feed `(seq, statKey)` that can be proven on-chain, so in
 * replay/live mode every minted moment verifies. Full time is a phase, not a
 * provable stat, so it's a canvas/ticker beat but not a collectible.
 */
const MILESTONE: ReadonlySet<MatchEventType> = new Set(["goal", "red_card"]);

/** How long after the event we wait to capture the emotional PEAK (crowd lag). */
const PEAK_CAPTURE_MS = 1000;
/** The moment window: from just before the event to just past the peak capture. */
const WINDOW_BEFORE_MS = 2000;
const WINDOW_AFTER_MS = PEAK_CAPTURE_MS + 300;
/** How many points the shared intensity curve is downsampled to for the sparkline. */
const CURVE_POINTS = 28;

interface EmotionSample {
  ts: number;
  intensity: number;
  /** This window's reaction counts (per-window; summed across the moment window). */
  counts: ReactionCounts;
}

interface ReactionMark {
  ts: number;
  name: string;
}

class MomentService {
  /** Recent emotional-heartbeat samples per fixture, for peak + curve + breakdown. */
  private readonly samples = new Map<string, EmotionSample[]>();
  /** Recent NAMED reactions per fixture, for the Fan MVP. */
  private readonly reactions = new Map<string, ReactionMark[]>();

  start(): void {
    bus.on("match_event", (event) => this.onMatchEvent(event));
  }

  /** Feed the aggregator's emotional heartbeat in so we can find peaks + curves. */
  observeEmotion(state: EmotionalState): void {
    const arr = this.samples.get(state.fixtureId) ?? [];
    arr.push({ ts: state.ts, intensity: state.intensity, counts: state.counts });
    // Keep ~5s of history; that's plenty to bracket the moment window.
    const cutoff = state.ts - 5000;
    this.samples.set(
      state.fixtureId,
      arr.filter((s) => s.ts >= cutoff),
    );
  }

  /** Record a single NAMED reaction so we can crown a Fan MVP for a moment. */
  observeReaction(fixtureId: string, name: string | undefined): void {
    if (!name) return; // anonymous "just here for the vibes" fans can't be MVP
    const now = Date.now();
    const arr = this.reactions.get(fixtureId) ?? [];
    arr.push({ ts: now, name });
    this.reactions.set(
      fixtureId,
      arr.filter((r) => r.ts >= now - 6000),
    );
  }

  private onMatchEvent(event: MatchEvent): void {
    if (!MILESTONE.has(event.type)) return;

    // Wait a beat for the crowd to erupt, then snapshot the peak intensity.
    setTimeout(() => this.capture(event), PEAK_CAPTURE_MS);
  }

  private capture(event: MatchEvent): void {
    const window = this.momentWindow(event.fixtureId, event.ts);
    const room = detector.getRoomState(event.fixtureId);
    const participants = room?.participants ?? ["Home", "Away"];
    const score = room?.score ?? [0, 0];

    const moment: VerifiedMoment = {
      id: randomUUID(),
      fixtureId: event.fixtureId,
      participants,
      score,
      eventType: event.type,
      team: event.team,
      label: event.label,
      minute: event.minute,
      seq: event.seq,
      statKey: event.statKey,
      intensity: Math.max(window.peak, event.intensity),
      curve: window.curve,
      reactions: window.reactions,
      mvp: this.fanMvp(event.fixtureId, event.ts),
      ts: event.ts,
      verification: canVerify(event)
        ? { status: "pending" }
        : { status: "unverified", reason: unverifiableReason() },
    };

    // Emit immediately so the card appears instantly; verification streams in.
    bus.emit("verified_moment", moment);

    if (canVerify(event)) {
      void this.verify(moment);
    }
  }

  /** Anchor the moment on-chain, then re-emit it with the result. */
  private async verify(moment: VerifiedMoment): Promise<void> {
    try {
      const proof = await fetchStatProof(moment.fixtureId, moment.seq, moment.statKey!);
      const result = await validateStatOnChain(proof);
      const verification: MomentVerification = result.valid
        ? {
            status: "verified",
            root: result.root,
            pda: result.pda,
            epochDay: result.epochDay,
            explorer: result.explorer,
          }
        : { status: "unverified", reason: "on-chain proof did not validate" };
      bus.emit("verified_moment", { ...moment, verification });
      console.log(
        `[moment] ${moment.label} → ${result.valid ? "VERIFIED on Solana" : "proof invalid"} (${result.pda})`,
      );
    } catch (err) {
      bus.emit("verified_moment", {
        ...moment,
        verification: { status: "unverified", reason: (err as Error).message },
      });
      console.warn(`[moment] verify failed for ${moment.label}:`, (err as Error).message);
    }
  }

  /** Peak intensity, the sampled surge curve, and the reaction breakdown together. */
  private momentWindow(
    fixtureId: string,
    eventTs: number,
  ): { peak: number; curve: number[]; reactions: ReactionCounts } {
    const from = eventTs - WINDOW_BEFORE_MS;
    const to = eventTs + WINDOW_AFTER_MS;
    const inWin = (this.samples.get(fixtureId) ?? []).filter((s) => s.ts >= from && s.ts <= to);

    let peak = 0;
    const reactions = emptyCounts();
    for (const s of inWin) {
      peak = Math.max(peak, s.intensity);
      for (const t of Object.keys(reactions) as ReactionType[]) reactions[t] += s.counts[t];
    }
    return { peak, curve: downsample(inWin.map((s) => s.intensity), CURVE_POINTS), reactions };
  }

  /** The fan who tapped the most in the moment window (needs ≥2 taps to earn it). */
  private fanMvp(fixtureId: string, eventTs: number): string | undefined {
    const from = eventTs - WINDOW_BEFORE_MS;
    const to = eventTs + WINDOW_AFTER_MS;
    const tally = new Map<string, number>();
    for (const r of this.reactions.get(fixtureId) ?? []) {
      if (r.ts >= from && r.ts <= to) tally.set(r.name, (tally.get(r.name) ?? 0) + 1);
    }
    let best: string | undefined;
    let bestN = 1;
    for (const [name, n] of tally) {
      if (n > bestN) {
        bestN = n;
        best = name;
      }
    }
    return best;
  }
}

/** Reduce a series to at most `n` points by averaging contiguous buckets. */
function downsample(values: number[], n: number): number[] {
  if (values.length <= n) return values.map((v) => round2(v));
  const out: number[] = [];
  const size = values.length / n;
  for (let i = 0; i < n; i++) {
    const start = Math.floor(i * size);
    const end = Math.max(start + 1, Math.floor((i + 1) * size));
    let sum = 0;
    for (let j = start; j < end; j++) sum += values[j];
    out.push(round2(sum / (end - start)));
  }
  return out;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * A moment can be on-chain verified only against a REAL feed stat with a live
 * token. That's true for genuine live goals AND verified-replay milestones (both
 * carry a real seq+statKey → `provable`); a fabricated simulator event is not.
 */
function canVerify(event: MatchEvent): boolean {
  const realStat = event.provable === true || config.feedMode === "live";
  return (
    realStat &&
    hasLiveToken() &&
    event.statKey != null &&
    Number.isFinite(event.seq)
  );
}

function unverifiableReason(): string {
  if (!hasLiveToken()) return "No TxLINE API token — run setup:txline to enable verification";
  if (config.feedMode === "sim") return "Simulated feed — no on-chain Merkle proof exists";
  return "No feed stat key for this event";
}

export const momentService = new MomentService();
export { explorerUrl };
