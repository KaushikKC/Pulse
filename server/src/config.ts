import "dotenv/config";

/**
 * Central config. PULSE runs in three feed modes:
 *  - "sim"    → built-in fabricated matches (default; needs no creds; lively but
 *               NOT provable — moments are honestly marked "unverified").
 *  - "replay" → replays a REAL past fixture scripted with its real goals/cards, so
 *               EVERY captured moment auto-verifies on Solana for real. Needs a
 *               TxLINE token (setup:txline). The best demo: lively AND provable.
 *  - "live"   → real TxLINE SSE streams (real-time; empty on devnet as fixtures
 *               are only scheduled).
 *
 * The architecture's golden rule: ONE backend connection in, MANY out. The mode
 * only changes where score/odds frames originate; everything downstream is identical.
 *
 * On-chain network is "devnet" by default (free to subscribe, no real SOL). The
 * TxLINE program + API base + TxL mint all differ per network, so we resolve them
 * together from NETWORK.
 */

const network = (process.env.NETWORK ?? "devnet") as "devnet" | "mainnet";

// TxLINE Solana program addresses + TxL token mints (from the TxLINE docs).
const CHAIN = {
  devnet: {
    apiBase: "https://txline-dev.txodds.com",
    solanaRpc: "https://api.devnet.solana.com",
    programId: "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J",
    txlMint: "4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG",
  },
  mainnet: {
    apiBase: "https://txline.txodds.com",
    solanaRpc: "https://api.mainnet-beta.solana.com",
    programId: "9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA",
    txlMint: "Zhw9TVKp68a1QrftncMSd6ELXKDtpVMNuMGr1jNwdeL",
  },
} as const;

const chain = CHAIN[network];

export const config = {
  port: Number(process.env.PORT ?? 4000),
  corsOrigin: process.env.CORS_ORIGIN ?? "*",

  feedMode: (process.env.FEED_MODE ?? "sim") as "sim" | "replay" | "live",
  network,

  txline: {
    // Override the API base only if you must; defaults follow NETWORK.
    baseUrl: process.env.TXLINE_BASE_URL ?? chain.apiBase,
    /** Activated API token (from /api/token/activate). Required for live mode. */
    apiToken: process.env.TXLINE_API_TOKEN ?? "",
    /** Guest JWT (from /auth/guest/start) used as the Bearer for streams. */
    jwt: process.env.TXLINE_JWT ?? "",
    /**
     * Free World Cup tier. Devnet only supports Service Level 1 (60s delay);
     * real-time Service Level 12 is mainnet-only. Default follows NETWORK.
     */
    serviceLevelId: Number(
      process.env.TXLINE_SERVICE_LEVEL ?? (network === "mainnet" ? 12 : 1),
    ),
    /** How many weeks to subscribe for per the docs' example. */
    durationWeeks: Number(process.env.TXLINE_DURATION_WEEKS ?? 4),
  },

  solana: {
    rpc: process.env.SOLANA_RPC ?? chain.solanaRpc,
    programId: process.env.TXLINE_PROGRAM_ID ?? chain.programId,
    txlMint: process.env.TXLINE_TXL_MINT ?? chain.txlMint,
    /** Path to a Solana CLI keypair JSON (array of bytes) used to subscribe + sign. */
    keypairPath: process.env.TXLINE_WALLET_KEYPAIR ?? "",
  },

  /** Reaction aggregation window in ms (doc: ~250ms). */
  aggregationWindowMs: Number(process.env.AGG_WINDOW_MS ?? 250),

  /**
   * A known real devnet goal used by the "verify a real goal on Solana" demo
   * button — its Merkle proof validates against a published daily-scores root.
   * Override to showcase a different fixture.
   */
  demoMoment: {
    fixtureId: process.env.DEMO_FIXTURE_ID ?? "17952170",
    seq: Number(process.env.DEMO_SEQ ?? 941),
    statKey: Number(process.env.DEMO_STAT_KEY ?? 1002),
    home: process.env.DEMO_HOME ?? "Home",
    away: process.env.DEMO_AWAY ?? "Away",
  },

  /**
   * The real fixture the "replay" feed mode plays back. Its milestones carry real
   * `(seq, statKey)` proof tuples (see replay.ts) discovered from the fixture's
   * snapshot timeline — every one validates on-chain. Team names default to the
   * honest "Home"/"Away" (the devnet feed only exposes participant IDs); override
   * with REPLAY_HOME / REPLAY_AWAY if you know them.
   */
  replay: {
    fixtureId: process.env.REPLAY_FIXTURE_ID ?? "17952170",
    home: process.env.REPLAY_HOME ?? "Home",
    away: process.env.REPLAY_AWAY ?? "Away",
  },

  /**
   * Run the synthetic crowd so a room is never dead — even in live mode when the
   * feed is quiet. Real match events still spike it. Set SYNTHETIC_CROWD=false to
   * show only genuine human reactions.
   */
  syntheticCrowd: (process.env.SYNTHETIC_CROWD ?? "true") !== "false",
} as const;

export type FeedMode = (typeof config)["feedMode"];
