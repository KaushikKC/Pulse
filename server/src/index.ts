import { createServer } from "node:http";
import express from "express";
import cors from "cors";
import { Server } from "socket.io";
import type {
  ClientToServer,
  EmotionalState,
  FixtureSummary,
  MatchEvent,
  RoomState,
  ServerToClient,
  VerifiedMoment,
} from "@pulse/shared";

import { config } from "./config.js";
import { bus } from "./bus.js";
import { detector } from "./events/detector.js";
import { Simulator } from "./txline/simulator.js";
import { Replay } from "./txline/replay.js";
import { TxLineIngest } from "./txline/ingest.js";
import { fetchFixturesSnapshot, fixtureRegistry } from "./txline/fixtures.js";
import { ReactionAggregator } from "./reactions/aggregator.js";
import { SyntheticCrowd } from "./reactions/syntheticCrowd.js";
import { roomManager } from "./rooms/roomManager.js";
import { momentService } from "./moments/momentService.js";
import { hasLiveToken, verifyStat } from "./txline/validation.js";

// ---------------------------------------------------------------------------
// HTTP + Socket.IO
// ---------------------------------------------------------------------------

const app = express();
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());

let knownFixtures: FixtureSummary[] = [];

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    feedMode: config.feedMode,
    network: config.network,
    onChainVerify: hasLiveToken(),
    fixtures: knownFixtures.length,
  });
});

app.get("/api/fixtures", (_req, res) => {
  // Merge in the detector's live score/phase so the lobby cards feel alive.
  res.json(
    knownFixtures.map((f) => {
      const live = detector.getRoomState(f.fixtureId);
      return live
        ? { ...f, phase: live.phase, score: live.score, minute: live.minute }
        : f;
    }),
  );
});

/**
 * On-demand on-chain verification of a specific real stat — the demo-safe way to
 * show a genuine Solana-verified moment even when no live goal is happening.
 * Needs a live TxLINE token (setup:txline). Body: { fixtureId, seq, statKey }.
 */
app.post("/api/moments/verify", async (req, res) => {
  const { fixtureId, seq, statKey } = req.body ?? {};
  if (fixtureId == null || seq == null || statKey == null) {
    return res.status(400).json({ error: "fixtureId, seq and statKey are required" });
  }
  if (!hasLiveToken()) {
    return res.status(400).json({
      error: "no TxLINE API token — run `npm run setup:txline -w @pulse/server` first",
    });
  }
  try {
    const result = await verifyStat(fixtureId, Number(seq), Number(statKey));
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

/**
 * Demo affordance: verify a known real goal on-chain and return it as a fully
 * formed VerifiedMoment the UI can render as a "✓ Verified on Solana" card. Lets
 * judges see genuine on-chain verification even when no live goal is happening.
 */
app.get("/api/moments/demo", async (_req, res) => {
  if (!hasLiveToken()) {
    return res.status(400).json({
      error: "no TxLINE API token — run `npm run setup:txline -w @pulse/server` first",
    });
  }
  const d = config.demoMoment;
  try {
    const r = await verifyStat(d.fixtureId, d.seq, d.statKey);
    const moment: VerifiedMoment = {
      id: `demo-${d.fixtureId}-${d.seq}`,
      fixtureId: d.fixtureId,
      participants: [d.home, d.away],
      score: [Math.max(1, r.statValue), 0],
      eventType: "goal",
      team: 1,
      label: "Real TxLINE goal",
      seq: d.seq,
      statKey: d.statKey,
      intensity: 1,
      ts: Date.now(),
      verification: r.valid
        ? { status: "verified", root: r.root, pda: r.pda, epochDay: r.epochDay, explorer: r.explorer }
        : { status: "unverified", reason: "on-chain proof did not validate" },
    };
    res.json(moment);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

const httpServer = createServer(app);
const io = new Server<ClientToServer, ServerToClient>(httpServer, {
  cors: { origin: config.corsOrigin },
});

// ---------------------------------------------------------------------------
// Pipeline: ingest → detector → bus → fan-out + aggregator
// ---------------------------------------------------------------------------

detector.start();
momentService.start();

const aggregator = new ReactionAggregator(
  config.aggregationWindowMs,
  (state: EmotionalState) => {
    // One fused emotional heartbeat per room per window.
    io.to(room(state.fixtureId)).emit("emotion", state);
    // Feed the peak detector so captured moments hold the true emotional peak.
    momentService.observeEmotion(state);
  },
  (fixtureId) => roomManager.presence(fixtureId),
);
aggregator.start();

// Match events: broadcast to the room AND spike the canvas energy.
bus.on("match_event", (event: MatchEvent) => {
  io.to(room(event.fixtureId)).emit("match_event", event);
  aggregator.spike(event.fixtureId, event.intensity);
});

// Collectible moments: broadcast to the room as they're captured/verified.
bus.on("verified_moment", (moment: VerifiedMoment) => {
  io.to(room(moment.fixtureId)).emit("verified_moment", moment);
});

// Authoritative room/fixture state (score, phase, minute).
bus.on("room_state", (state: RoomState) => {
  io.to(room(state.fixtureId)).emit("room_state", {
    ...state,
    present: roomManager.presence(state.fixtureId),
  });
});

// Feed source.
if (config.feedMode === "live") {
  // Populate the match list + team-name registry from the fixtures snapshot,
  // then open the SSE stream. Without this the lobby has nothing to join.
  fetchFixturesSnapshot()
    .then((fixtures) => {
      fixtureRegistry.setAll(fixtures);
      knownFixtures = fixtures.map((f) => ({
        fixtureId: f.fixtureId,
        participants: f.participants,
        phase: 1,
        live: true,
      }));
      console.log(`[pulse] loaded ${knownFixtures.length} fixtures from snapshot`);
    })
    .catch((err) => console.warn("[pulse] fixtures snapshot failed:", err.message));

  const ingest = new TxLineIngest();
  ingest.start();
  console.log("[pulse] feed mode: LIVE (TxLINE SSE)");
} else if (config.feedMode === "replay") {
  // Replay a real fixture whose milestones each prove on-chain. Register the team
  // names so score frames + moments resolve them, then start the scripted replay.
  const replay = new Replay();
  knownFixtures = replay.fixtures();
  fixtureRegistry.setAll(
    knownFixtures.map((f) => ({ fixtureId: f.fixtureId, participants: f.participants })),
  );
  replay.start();
  console.log("[pulse] feed mode: REPLAY (verified replay of a real fixture)");
  if (!hasLiveToken()) {
    console.warn(
      "[pulse] REPLAY needs a TxLINE token to verify moments — run `npm run setup:txline`",
    );
  }
} else {
  const sim = new Simulator();
  knownFixtures = sim.fixtures();
  sim.start();
  console.log("[pulse] feed mode: SIM (fabricated matches — moments unverified)");
}

// Synthetic crowd keeps any joined room alive (the top demo risk) — in BOTH modes.
// Real match events still spike it; it only animates rooms with people in them.
if (config.syntheticCrowd) {
  const crowd = new SyntheticCrowd(
    aggregator,
    () => knownFixtures.map((f) => f.fixtureId),
    (fixtureId) => roomManager.presence(fixtureId),
  );
  crowd.start();
  bus.on("match_event", (event) => crowd.onMatchEvent(event));
}

// ---------------------------------------------------------------------------
// Socket connections (the "many out")
// ---------------------------------------------------------------------------

/**
 * Authoritative room snapshot: the detector's live score/phase when present, but
 * always prefer the fixtures-snapshot team names (the detector may hold "Home/Away"
 * placeholders seeded from an early odds frame). Includes live presence.
 */
function roomStateOf(fixtureId: string): RoomState | null {
  const state = detector.getRoomState(fixtureId);
  const snapshot = knownFixtures.find((x) => x.fixtureId === fixtureId);
  if (!state && !snapshot) return null;
  return {
    fixtureId,
    participants: snapshot?.participants ?? state?.participants ?? ["Home", "Away"],
    phase: state?.phase ?? snapshot?.phase ?? 1,
    score: state?.score ?? [0, 0],
    minute: state?.minute,
    present: roomManager.presence(fixtureId),
  };
}

io.on("connection", (socket) => {
  socket.on("join", ({ fixtureId, team, name }) => {
    socket.join(room(fixtureId));
    roomManager.join(fixtureId, socket.id, team, name?.trim().slice(0, 24) || undefined);

    // Broadcast to the whole room: backfills the joiner AND updates everyone's
    // presence count the instant a fan walks in.
    const state = roomStateOf(fixtureId);
    if (state) io.to(room(fixtureId)).emit("room_state", state);
  });

  socket.on("leave", ({ fixtureId }) => {
    socket.leave(room(fixtureId));
    roomManager.leave(fixtureId, socket.id);
    const state = roomStateOf(fixtureId);
    if (state) io.to(room(fixtureId)).emit("room_state", state);
  });

  socket.on("react", ({ fixtureId, type }) => {
    const team = roomManager.teamOf(fixtureId, socket.id);
    const name = roomManager.nameOf(fixtureId, socket.id);
    aggregator.add(fixtureId, type, team);
    // Track named taps so a captured moment can crown its Fan MVP.
    momentService.observeReaction(fixtureId, name);
    // Immediate floater for snappy local feedback (separate from the 250ms fuse).
    io.to(room(fixtureId)).emit("reaction_pop", { type, team, name });
  });

  socket.on("disconnect", () => {
    for (const fixtureId of roomManager.leaveAll(socket.id)) {
      const state = roomStateOf(fixtureId);
      if (state) io.to(room(fixtureId)).emit("room_state", state);
    }
  });
});

const room = (fixtureId: string) => `fixture:${fixtureId}`;

httpServer.listen(config.port, () => {
  console.log(`[pulse] server listening on http://localhost:${config.port}`);
});
