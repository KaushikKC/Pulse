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
} from "@pulse/shared";

import { config } from "./config.js";
import { bus } from "./bus.js";
import { detector } from "./events/detector.js";
import { Simulator } from "./txline/simulator.js";
import { TxLineIngest } from "./txline/ingest.js";
import { ReactionAggregator } from "./reactions/aggregator.js";
import { SyntheticCrowd } from "./reactions/syntheticCrowd.js";
import { roomManager } from "./rooms/roomManager.js";

// ---------------------------------------------------------------------------
// HTTP + Socket.IO
// ---------------------------------------------------------------------------

const app = express();
app.use(cors({ origin: config.corsOrigin }));

let knownFixtures: FixtureSummary[] = [];

app.get("/health", (_req, res) => {
  res.json({ ok: true, feedMode: config.feedMode, fixtures: knownFixtures.length });
});

app.get("/api/fixtures", (_req, res) => {
  res.json(knownFixtures);
});

const httpServer = createServer(app);
const io = new Server<ClientToServer, ServerToClient>(httpServer, {
  cors: { origin: config.corsOrigin },
});

// ---------------------------------------------------------------------------
// Pipeline: ingest → detector → bus → fan-out + aggregator
// ---------------------------------------------------------------------------

detector.start();

const aggregator = new ReactionAggregator(
  config.aggregationWindowMs,
  (state: EmotionalState) => {
    // One fused emotional heartbeat per room per window.
    io.to(room(state.fixtureId)).emit("emotion", state);
  },
  (fixtureId) => roomManager.presence(fixtureId),
);
aggregator.start();

// Match events: broadcast to the room AND spike the canvas energy.
bus.on("match_event", (event: MatchEvent) => {
  io.to(room(event.fixtureId)).emit("match_event", event);
  aggregator.spike(event.fixtureId, event.intensity);
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
  const ingest = new TxLineIngest();
  ingest.start();
  // Live fixtures would come from /api/fixtures/snapshot; expose what we learn.
  bus.on("room_state", (s) => {
    if (!knownFixtures.find((f) => f.fixtureId === s.fixtureId)) {
      knownFixtures.push({
        fixtureId: s.fixtureId,
        participants: s.participants,
        phase: s.phase,
        live: true,
      });
    }
  });
  console.log("[pulse] feed mode: LIVE (TxLINE SSE)");
} else {
  const sim = new Simulator();
  knownFixtures = sim.fixtures();
  sim.start();

  // Synthetic crowd so the room always looks alive (top demo risk mitigation).
  const crowd = new SyntheticCrowd(aggregator, () => knownFixtures.map((f) => f.fixtureId));
  crowd.start();
  bus.on("match_event", (event) => crowd.onMatchEvent(event));
  console.log("[pulse] feed mode: SIM (simulated crowd + replay)");
}

// ---------------------------------------------------------------------------
// Socket connections (the "many out")
// ---------------------------------------------------------------------------

io.on("connection", (socket) => {
  socket.on("join", ({ fixtureId, team, name }) => {
    socket.join(room(fixtureId));
    roomManager.join(fixtureId, socket.id, team, name);

    // Backfill on join: send current room state immediately so the new tab isn't blank.
    const state = detector.getRoomState(fixtureId);
    if (state) {
      socket.emit("room_state", { ...state, present: roomManager.presence(fixtureId) });
    }
  });

  socket.on("leave", ({ fixtureId }) => {
    socket.leave(room(fixtureId));
    roomManager.leave(fixtureId, socket.id);
  });

  socket.on("react", ({ fixtureId, type }) => {
    const team = roomManager.teamOf(fixtureId, socket.id);
    aggregator.add(fixtureId, type, team);
    // Immediate floater for snappy local feedback (separate from the 250ms fuse).
    io.to(room(fixtureId)).emit("reaction_pop", { type, team });
  });

  socket.on("disconnect", () => {
    roomManager.leaveAll(socket.id);
  });
});

const room = (fixtureId: string) => `fixture:${fixtureId}`;

httpServer.listen(config.port, () => {
  console.log(`[pulse] server listening on http://localhost:${config.port}`);
});
