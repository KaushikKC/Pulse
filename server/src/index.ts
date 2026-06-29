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
import { fetchFixturesSnapshot, fixtureRegistry } from "./txline/fixtures.js";
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
} else {
  const sim = new Simulator();
  knownFixtures = sim.fixtures();
  sim.start();
  console.log("[pulse] feed mode: SIM (simulated crowd + replay)");
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

io.on("connection", (socket) => {
  socket.on("join", ({ fixtureId, team, name }) => {
    socket.join(room(fixtureId));
    roomManager.join(fixtureId, socket.id, team, name);

    // Backfill on join so the new tab isn't blank. Use the detector's live score/
    // phase when present, but always prefer the fixtures-snapshot team names (the
    // detector may hold "Home/Away" placeholders seeded from an early odds frame).
    const present = roomManager.presence(fixtureId);
    const state = detector.getRoomState(fixtureId);
    const snapshot = knownFixtures.find((x) => x.fixtureId === fixtureId);
    if (state || snapshot) {
      socket.emit("room_state", {
        fixtureId,
        participants: snapshot?.participants ?? state?.participants ?? ["Home", "Away"],
        phase: state?.phase ?? snapshot?.phase ?? 1,
        score: state?.score ?? [0, 0],
        minute: state?.minute,
        present,
      });
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
