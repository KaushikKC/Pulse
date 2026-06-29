import {
  GamePhase,
  StatKey,
  type OddsFrame,
  type ScoreFrame,
} from "@pulse/shared";
import { bus } from "../bus.js";
import { config } from "../config.js";
import { fixtureRegistry } from "./fixtures.js";

/**
 * Live TxLINE ingest — the single backend connection IN (golden rule of data flow).
 *
 * Holds one SSE connection to /api/scores/stream and one to /api/odds/stream,
 * decodes each event, normalizes it into ScoreFrame / OddsFrame, and publishes to
 * the bus. Reconnects with exponential backoff because "a frozen feed during the
 * demo is the worst outcome."
 *
 * Payload shape is mapped from the documented TxLINE soccer SSE schema:
 *   data.fixtureId, data.gameState ("HT"/"H1"/…), data.seq,
 *   data.scoreSoccer.Participant{1,2}.Total.{Goals,YellowCards,RedCards,Corners},
 *   data.dataSoccer.Minutes.
 */
export class TxLineIngest {
  private stopped = false;

  start(): void {
    if (!config.txline.apiToken || !config.txline.jwt) {
      console.warn(
        "[ingest] FEED_MODE=live but TXLINE_API_TOKEN / TXLINE_JWT are not set — " +
          "run `npm run setup:txline -w @pulse/server` first (see README).",
      );
    }
    console.log(`[ingest] live feed from ${config.txline.baseUrl} (${config.network})`);
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
        if (/^event:\s*heartbeat/m.test(rawEvent)) continue;
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

  // --- payload mapping ---------------------------------------------------------

  /** SSE payloads may arrive wrapped as { id, event, data } or as the bare data. */
  private unwrap(json: unknown): Record<string, any> {
    const o = json as Record<string, any>;
    return o && typeof o === "object" && o.data && typeof o.data === "object" ? o.data : o;
  }

  private mapScore(json: unknown): void {
    const d = this.unwrap(json);
    // Real devnet frames use capitalized keys (FixtureId/GameState/ScoreSoccer);
    // the docs example used lowercase. Accept both.
    const fixtureId = String(pick(d, "FixtureId", "fixtureId", "fixture_id") ?? "");
    if (!fixtureId) return;

    const score = pick(d, "ScoreSoccer", "scoreSoccer") ?? {};
    const t1 = (score.Participant1 ?? score.participant1)?.Total ?? {};
    const t2 = (score.Participant2 ?? score.participant2)?.Total ?? {};
    const stats: Record<number, number> = {
      [StatKey.GoalsP1]: num(t1.Goals),
      [StatKey.GoalsP2]: num(t2.Goals),
      [StatKey.YellowP1]: num(t1.YellowCards),
      [StatKey.YellowP2]: num(t2.YellowCards),
      [StatKey.RedP1]: num(t1.RedCards),
      [StatKey.RedP2]: num(t2.RedCards),
      [StatKey.CornersP1]: num(t1.Corners),
      [StatKey.CornersP2]: num(t2.Corners),
    };

    // Names come from the fixtures snapshot registry (feed only carries IDs).
    const known = fixtureRegistry.names_(fixtureId);
    const participants: [string, string] = known ?? [
      String(d.participant1Name ?? `Team ${d.participant1Id ?? "1"}`),
      String(d.participant2Name ?? `Team ${d.participant2Id ?? "2"}`),
    ];

    const dataSoccer = pick(d, "DataSoccer", "dataSoccer") ?? {};
    const minute = pick(dataSoccer, "Minutes", "minutes") ?? pick(d, "Minutes");
    const frame: ScoreFrame = {
      fixtureId,
      seq: num(pick(d, "Seq", "seq", "sequence")),
      phase: phaseFromGameState(pick(d, "GameState", "gameState", "statusId", "StatusId")),
      stats,
      participants,
      minute: minute != null ? Number(minute) : undefined,
    };
    bus.emit("score_frame", frame);
  }

  private mapOdds(json: unknown): void {
    const d = this.unwrap(json);
    const fixtureId = String(pick(d, "FixtureId", "fixtureId", "fixture_id") ?? "");
    if (!fixtureId) return;

    const impliedProb = pick(d, "impliedProb", "ImpliedProb");
    const prices = pick(d, "prices", "Prices");
    let implied: [number, number, number] | null = null;
    if (Array.isArray(impliedProb)) {
      implied = [Number(impliedProb[0]), Number(impliedProb[1]), Number(impliedProb[2])];
    } else if (Array.isArray(prices) && prices.length >= 3) {
      const inv = prices.map((p: number) => (p > 0 ? 1 / p : 0));
      const sum = inv.reduce((a: number, b: number) => a + b, 0) || 1;
      implied = [(inv[0] / sum) * 100, (inv[1] / sum) * 100, (inv[2] / sum) * 100];
    }
    if (!implied) return;

    bus.emit("odds_frame", {
      fixtureId,
      seq: num(pick(d, "Seq", "seq", "sequence")),
      impliedProb: implied,
    });
  }
}

/** Return the first defined value among the given keys (casing-tolerant reads). */
function pick(obj: Record<string, any>, ...keys: string[]): any {
  for (const k of keys) if (obj?.[k] !== undefined) return obj[k];
  return undefined;
}

const num = (v: unknown): number => (typeof v === "number" ? v : Number(v) || 0);
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Map TxLINE string game-state codes to our numeric GamePhase. */
function phaseFromGameState(code: unknown): number {
  const c = String(code ?? "").toUpperCase();
  const map: Record<string, number> = {
    NS: GamePhase.NotStarted,
    H1: GamePhase.FirstHalf,
    "1H": GamePhase.FirstHalf,
    HT: GamePhase.HalfTime,
    H2: GamePhase.SecondHalf,
    "2H": GamePhase.SecondHalf,
    FT: GamePhase.Ended,
    ENDED: GamePhase.Ended,
    AET: GamePhase.FullExtraTime,
    ET1: GamePhase.ExtraTime1,
    ETHT: GamePhase.HalfTimeExtraTime,
    ET2: GamePhase.ExtraTime2,
    PE: GamePhase.Penalties,
    PEN: GamePhase.Penalties,
    FPE: GamePhase.FullPenalties,
    INT: GamePhase.Interrupted,
    SUSP: GamePhase.Interrupted,
    ABAN: GamePhase.Abandoned,
    CANC: GamePhase.Cancelled,
    POST: GamePhase.Postponed,
  };
  return map[c] ?? GamePhase.NotStarted;
}
