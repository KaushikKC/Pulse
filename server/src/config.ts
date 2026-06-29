import "dotenv/config";

/**
 * Central config. PULSE runs in two feed modes:
 *  - "sim"  → the built-in simulated crowd / replay feed (default; needs no creds).
 *  - "live" → real TxLINE SSE streams using a TxLINE API token.
 *
 * The architecture's golden rule: ONE backend connection in, MANY out. The mode
 * only changes where score/odds frames originate; everything downstream is identical.
 */
export const config = {
  port: Number(process.env.PORT ?? 4000),
  corsOrigin: process.env.CORS_ORIGIN ?? "*",

  feedMode: (process.env.FEED_MODE ?? "sim") as "sim" | "live",

  txline: {
    baseUrl: process.env.TXLINE_BASE_URL ?? "https://txline.txodds.com",
    /** Activated API token (from /api/token/activate). Required for live mode. */
    apiToken: process.env.TXLINE_API_TOKEN ?? "",
    /** Guest JWT (from /auth/guest/start) used as the Bearer for streams. */
    jwt: process.env.TXLINE_JWT ?? "",
    /** Service Level 12 = World Cup + Int Friendlies, real-time. */
    serviceLevelId: Number(process.env.TXLINE_SERVICE_LEVEL ?? 12),
  },

  /** Reaction aggregation window in ms (doc: ~250ms). */
  aggregationWindowMs: Number(process.env.AGG_WINDOW_MS ?? 250),
} as const;

export type FeedMode = (typeof config)["feedMode"];
