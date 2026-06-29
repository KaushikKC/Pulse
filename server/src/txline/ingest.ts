import {
  StatKey,
  type OddsFrame,
  type ScoreFrame,
} from "@pulse/shared";
import { bus } from "../bus.js";
import { config } from "../config.js";

/**
 * Live TxLINE ingest — the single backend connection IN (golden rule of data flow).
 *
 * Holds one SSE connection to /api/scores/stream and one to /api/odds/stream,
 * decodes each event, normalizes it into ScoreFrame / OddsFrame, and publishes to
 * the bus. Reconnects with exponential backoff because "a frozen feed during the
 * demo is the worst outcome."
 *
 * NOTE: the exact JSON shape of TxLINE stream payloads is mapped in `mapScore` /
 * `mapOdds`. They are written defensively against the documented data model
 * (game phases, stat keys 1/2/3/4/5/6, implied odds) and are the one place to
 * adjust once you can see real frames in live mode.
 */
export class TxLineIngest {
  private stopped = false;

  start(): void {
    if (!config.txline.apiToken || !config.txline.jwt) {
      console.warn(
        "[ingest] FEED_MODE=live but TXLINE_API_TOKEN / TXLINE_JWT are not set — " +
          "no live frames will arrive. See README for the Solana subscribe + token activation flow.",
      );
    }
    this.consume("/api/scores/stream", (json) => this.mapScore(json));
    this.consume("/api/odds/stream", (json) => this.mapOdds(json));
  }

  stop(): void {
    this.stopped = true;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${config.txline.jwt}`,
      "X-Api-Token": config.txline.apiToken,
      Accept: "text/event-stream",
      "Accept-Encoding": "gzip",
    };
  }

  /** Connect to one SSE endpoint and keep it alive forever with backoff. */
  private async consume(path: string, onJson: (json: unknown) => void): Promise<void> {
    let attempt = 0;
    while (!this.stopped) {
      try {
        const url = `${config.txline.baseUrl}${path}`;
        const res = await fetch(url, { headers: this.headers() });
        if (!res.ok || !res.body) {
          throw new Error(`HTTP ${res.status} for ${path}`);
        }
        console.log(`[ingest] connected ${path}`);
        attempt = 0;
        await this.readStream(res.body, onJson);
      } catch (err) {
        if (this.stopped) return;
        attempt += 1;
        const backoff = Math.min(30_000, 500 * 2 ** attempt) + Math.random() * 250;
        console.warn(
          `[ingest] ${path} disconnected (${(err as Error).message}); ` +
            `reconnecting in ${Math.round(backoff)}ms`,
        );
        await delay(backoff);
      }
    }
  }

  /** Parse an SSE byte stream into `data:` JSON payloads. */
  private async readStream(
    body: ReadableStream<Uint8Array>,
    onJson: (json: unknown) => void,
  ): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (!this.stopped) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by a blank line; each may carry multiple data: lines.
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const data = rawEvent
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim())
          .join("");
        if (!data || data === "[DONE]") continue;
        try {
          onJson(JSON.parse(data));
        } catch {
          /* keep-alive / non-JSON line — ignore */
        }
      }
    }
  }

  // --- payload mapping (adjust to the real shape once visible in live mode) ----

  private mapScore(json: unknown): void {
    const o = json as Record<string, any>;
    const fixtureId = String(o.fixtureId ?? o.fixture_id ?? o.id ?? "");
    if (!fixtureId) return;

    const statsIn: Record<string, number> = o.stats ?? o.statistics ?? {};
    const stats: Record<number, number> = {};
    for (const key of Object.values(StatKey)) {
      const v = statsIn[String(key)];
      if (typeof v === "number") stats[key] = v;
    }

    const frame: ScoreFrame = {
      fixtureId,
      seq: Number(o.seq ?? o.sequence ?? 0),
      phase: Number(o.phase ?? o.gamePhase ?? o.game_phase ?? 1),
      stats,
      participants: [
        String(o.participants?.[0] ?? o.home ?? "Home"),
        String(o.participants?.[1] ?? o.away ?? "Away"),
      ],
      minute: o.minute != null ? Number(o.minute) : undefined,
    };
    bus.emit("score_frame", frame);
  }

  private mapOdds(json: unknown): void {
    const o = json as Record<string, any>;
    const fixtureId = String(o.fixtureId ?? o.fixture_id ?? o.id ?? "");
    if (!fixtureId) return;

    // Prefer explicit implied probabilities; otherwise derive from 1/X/2 prices.
    let implied: [number, number, number] | null = null;
    if (Array.isArray(o.impliedProb)) {
      implied = [Number(o.impliedProb[0]), Number(o.impliedProb[1]), Number(o.impliedProb[2])];
    } else if (Array.isArray(o.prices) && o.prices.length >= 3) {
      const inv = o.prices.map((p: number) => (p > 0 ? 1 / p : 0));
      const sum = inv.reduce((a: number, b: number) => a + b, 0) || 1;
      implied = [(inv[0] / sum) * 100, (inv[1] / sum) * 100, (inv[2] / sum) * 100];
    }
    if (!implied) return;

    const frame: OddsFrame = {
      fixtureId,
      seq: Number(o.seq ?? o.sequence ?? 0),
      impliedProb: implied,
    };
    bus.emit("odds_frame", frame);
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
