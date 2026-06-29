# PULSE — Product Plan, Goals & Build Status

**Last updated:** 2026-06-28
**Track:** Consumer & Fan Experiences — TxODDS World Cup Hackathon (Solana)
**Repo:** `WorldCup-Hackathon/Pulse/` · Architecture spec: `PULSE_architecture.md`

---

## 1. What we are making (in one breath)

**PULSE is a shared live "second screen" where you and your friends react to a World
Cup match together. Your collective emotion is fused with the real on-pitch data
from the TxLINE feed into a single living visualization — and the biggest emotional
peaks can be minted as cryptographically verifiable on-chain moments.**

It is two ideas welded into one product:

1. **The Emotion Twin** — the match's collective *feeling*, rendered as one living
   canvas that breathes when quiet and erupts on a real event (goal, red card, big
   odds swing).
2. **The Watch-Party Room** — you and your friends in a shared live room, reacting
   together, so the emotion is *collective*, not solitary.

They are one product because **the room is where the emotion is generated** and **the
emotion twin is what the room is looking at.** Machine truth (the verified live feed)
and human feeling (fan reactions), locked to the same timeline.

---

## 2. The ultimate goal of this product

### Hackathon goal (next ~3 weeks)
Win/place in the Consumer & Fan Experiences track by delivering a **complete, live,
beautiful** narrow slice that scores on every judging criterion — and demos flawlessly
in a ≤5-minute video even if no live match is running at judging time.

| Judging criterion | How PULSE wins it |
| --- | --- |
| Fan Accessibility & UX | One tap to react. Zero learning curve. A non-technical fan opens it for the *feeling*. |
| Real-Time Responsiveness | Whole experience driven by live SSE + live reactions; screen reacts within ~1s of a goal. |
| Originality & Value Creation | Fusing collective human emotion with verified on-chain match data is genuinely new. |
| Commercial & Monetization | Branded watch-party rooms, premium visual themes, collectible verified moments. |
| Completeness & Execution | Narrow slice, end-to-end, with simulated-crowd fallback so it always looks alive. |

### Product vision (beyond the hackathon)
The **emotional layer for live sports**. Every match, every league, a living shared
canvas of how the world feels — and a permanent, verifiable collection of the moments
that mattered. Not a betting market, not a stats feed repackage: the *feeling* of the
game, made social, visual, and ownable.

**Non-goal (hard boundary):** nothing resolves to a payout, nothing is a market. The
TxLINE feed is the *heartbeat the experience reacts to* — never something users bet on.
This keeps us strictly in the consumer track.

---

## 3. System architecture (the shape of the whole thing)

### The golden rule
**Never connect browsers directly to the TxLINE stream.** One backend connection IN,
many connections OUT. (Protects the API token, avoids duplicate upstream connections,
and guarantees every fan sees the same timing — which is what makes it feel "together.")

### The data flow

```
   TxLINE  /api/scores/stream  +  /api/odds/stream   (SSE, Bearer + X-Api-Token)
                       │  1 connection each
                       ▼
        ┌──────────────────────────────┐
        │  INGEST  (or SIMULATOR)       │   one connection in
        └───────────────┬──────────────┘
                        ▼  normalized score/odds frames
        ┌──────────────────────────────┐
        │  EVENT DETECTOR               │   diffs frames → goal / red / yellow /
        └───────────────┬──────────────┘   phase change / momentum swing / full time
                        ▼  normalized MatchEvents
        ┌──────────────────────────────┐
        │  EVENT BUS  (in-memory)       │   decouples ingest from fan-out
        └───────────────┬──────────────┘
                        ▼
        ┌──────────────────────────────┐      ┌─────────────────────────┐
        │  ROOM & FAN-OUT (Socket.IO)   │◀────▶│  REACTION AGGREGATOR     │
        │  rooms keyed by fixtureId     │      │  250ms windows → one     │
        └───────────────┬──────────────┘      │  fused "emotional state" │
                        ▼  WebSocket            └─────────────────────────┘
            ┌───────────┴───────────┐
            ▼           ▼           ▼
       ┌────────┐  ┌────────┐  ┌────────┐
       │Browser │  │Browser │  │Browser │   ← the living canvas
       │(canvas)│  │(canvas)│  │(canvas)│      tap reactions flow back up
       └────────┘  └────────┘  └────────┘
```

### The five components
1. **Ingest service** — holds the two SSE connections; reconnects with backoff.
2. **Room & fan-out (Socket.IO)** — rooms by fixtureId; match events in, aggregate out.
3. **Reaction aggregator** — windows taps (~250ms) into a collective emotional state.
4. **The visualization** — the hero; one living canvas of the room's emotion *now*.
5. **On-chain verified moments** — snapshot an emotional peak + real event, anchor it
   on Solana with a Merkle proof that the stat actually happened.

---

## 4. Tech stack & key decisions

| Layer | Choice | Why / status |
| --- | --- | --- |
| Language | Node + TypeScript | Same as TxLINE examples; fast to build. ✅ |
| Monorepo | npm workspaces (`shared` / `server` / `web`) | One `npm install`, shared protocol. ✅ |
| Event bus | In-memory `EventEmitter` | Doc's MVP choice; swap for Redis to scale. ✅ |
| Real-time fan-out | **Self-hosted Socket.IO** | Runs locally with zero external accounts. ✅ (managed Ably/Pusher is the scale path) |
| Frontend | React + **2D Canvas** | No WebGL dependency → runs anywhere, reliable in a screen recording. ✅ (WebGL/shaders is a polish upgrade) |
| Feed | Simulator (default) + live SSE adapter | Demo works with no credentials; live slots in via env. ✅ |
| On-chain | `@solana/web3.js` + `@coral-xyz/anchor` | Required for subscribe + `validateStat`. ⏳ not started |
| Hosting | Railway/Render/Fly (backend) + Vercel (web) | Must be a live URL for judges. ⏳ not started |

**Three deliberate "run-locally-today" defaults** (all swappable later): self-hosted
Socket.IO over managed; in-memory bus over Redis; 2D canvas over WebGL.

---

## 5. The full build plan, stage by stage

This follows the architecture's sequencing rule: **emotion twin solid FIRST → room →
on-chain LAST.** Each stage is a complete, demoable product even if the next slips.

### Stage 0 — Foundations & access
- Monorepo scaffold, shared protocol, dev tooling.
- Solana wallet + subscribe to Service Level 12 + activate TxLINE API token.
- Connect to scores/odds SSE, confirm payload shapes.

### Stage 1 — The Emotion Twin (live feed → visualization)
- Event detector (goal/card/phase/odds-swing) → normalized events on the bus.
- One backend → one browser over WebSocket; canvas spikes on a real/replayed goal.
- Make the visualization genuinely beautiful and alive. **The hero — over-invest.**

### Stage 2 — The Room (collective layer)
- Rooms keyed by fixture; join/leave; presence count.
- Tap-to-react UI (cheer/panic/rage/hype) + team selection (tint/split).
- Reaction aggregator (250ms windows) → fused emotional state broadcast to room.

### Stage 3 — On-chain Verified Moments
- Detect emotional-peak + real-event coincidence; snapshot the moment.
- `/api/scores/stat-validation` → Merkle proof → Solana `validateStat`; anchor/collect.
- "Moment" card UI with verification badge + shareable image.

### Stage 4 — Simulated crowd + polish
- Simulated-crowd mode (replay + synthetic reactions) so the demo always looks alive.
- Visual polish, mobile layout, share flow, harden reconnection.

### Stage 5 — Demo video + submission
- Record during a live match if possible; else use simulated-crowd mode.
- Public repo cleanup, technical docs, TxLINE API feedback note.

---

## 6. What we have ACTUALLY built (✅ done & verified)

The entire **emotion-twin + room core runs end-to-end and is verified live.** Sat in the
codebase right now:

### Shared protocol — `shared/src/index.ts`
- ✅ Single source of truth imported by both server and web (can't drift).
- ✅ TxLINE data model: game phases, stat keys (goals 1/2, yellow 3/4, red 5/6, corners 7/8).
- ✅ Normalized `MatchEvent`, `EmotionalState`, `RoomState`, reaction types, Socket.IO contracts.

### Server (`server/`)
- ✅ **`txline/ingest.ts`** — real SSE adapter for `/api/scores/stream` + `/api/odds/stream`
  with the documented auth headers and **exponential-backoff reconnect** (frozen feed = worst demo).
  Defensive payload mapping (`mapScore`/`mapOdds`) ready to adjust to real frames.
- ✅ **`txline/simulator.ts`** — scripted, looping Argentina–France final (early goals,
  yellow, red card, late equaliser, penalties) + continuous odds drift. **Runs with no credentials.**
- ✅ **`events/detector.ts`** — diffs successive frames into normalized events:
  goal (key 1/2), red (5/6), yellow (3/4), phase transitions (esp. ended/penalties),
  odds momentum swings (≥5 implied-prob pts). Tracks authoritative score/phase/minute per fixture.
- ✅ **`bus.ts`** — typed in-memory event bus decoupling ingest from fan-out.
- ✅ **`reactions/aggregator.ts`** — **250ms windowed fusion** → one `EmotionalState` per
  room (counts, per-team split, smoothed intensity, crowd tilt). Tuned so idle breathes
  at ~0.08 and a goal spikes to ~1.0 then decays — goals *feel* like spikes.
- ✅ **`reactions/syntheticCrowd.ts`** — ambient chatter + hard bursts on real events, so
  a solo judge never sees an empty room (the top demo risk).
- ✅ **`rooms/roomManager.ts`** — presence + which side each socket supports, per fixture.
- ✅ **`index.ts`** — Express + Socket.IO wiring; `join`/`leave`/`react`; backfill on join;
  `/health` + `/api/fixtures` endpoints; immediate reaction echo (`reaction_pop`).

### Web (`web/`)
- ✅ **`viz/EmotionCanvas.tsx`** — the hero. Living 2D-canvas particle field: breathing
  radial gradient, additive-blended particles, home/away split by supporter, **shockwaves +
  full-screen flash + particle bursts on a goal/red card**, smoothed energy easing.
- ✅ **`usePulse.ts`** — single client socket connection; join, stream events + emotion, react.
- ✅ **`components/`** — `RoomHeader` (live scoreboard/phase/minute/presence), `ReactionBar`
  (tap cheer/hype/panic/rage with vibrate), `EventTicker`, `Floaters` (emoji rising on the
  supporter's side), plus a side-pick **Lobby**.
- ✅ **`styles.css`** — full dark glassmorphism UI, mobile-responsive, animated branding.

### Verified working
- ✅ Both packages typecheck clean; web production bundle builds (62 KB gzip).
- ✅ Server boots; sim feed runs; `/health` + `/api/fixtures` respond.
- ✅ Socket probe confirmed: join → live scoreboard, ~4 emotion frames/sec, goal +
  momentum + phase events detected, intensity idle ~0.08 → event ~1.0 → decay.
- ✅ Vite dev server resolves the cross-workspace shared package at dev and build time.

**Run it today:** `npm install && npm run dev` → http://localhost:5173 (no credentials).
Open two tabs to feel two fans fuse into one canvas.

**Mapping to stages:** Stage 1 ✅ · Stage 2 ✅ · Stage 4 simulated-crowd ✅ (polish partial).

---

## 7. What is STILL PENDING (⏳ / ⛔)

### A. Live TxLINE access (Stage 0) — ⛔ blocked on credentials
- [ ] Solana wallet + subscribe to **Service Level 12** (World Cup + Int Friendlies, real-time).
- [ ] `POST /auth/guest/start` → guest JWT.
- [ ] `POST /api/token/activate` → API token.
- [ ] Put `FEED_MODE=live` + token/JWT in `server/.env`; confirm real frame shapes and
      adjust `mapScore`/`mapOdds` in `ingest.ts` to match.
- [ ] Wire `GET /api/fixtures/snapshot` for the real match list and
      `GET /api/scores/snapshot/{fixtureId}` for backfill on join.
- **Why pending:** needs a funded Solana wallet + the on-chain subscription. Code path
  is built and waiting; this is an access/ops step, not a coding one.

### B. On-chain Verified Moments (Stage 3) — ⏳ not started (deliberately last)
- [ ] Peak detector: emotional-intensity peak coinciding with a real MatchEvent → snapshot.
- [ ] `GET /api/scores/stat-validation?fixtureId=&seq=&statKey=` → Merkle proof.
- [ ] On-chain `validateStat` view call against daily Merkle roots on Solana.
- [ ] Anchor/collect the moment (mint or record) so it's a verifiable collectible.
- [ ] "Moment" card UI: verification badge + shareable image (canvas snapshot + score + proof).
- **Why pending:** the architecture says build this LAST — the product is complete and
  original without it if time runs short. It's the differentiator, not the foundation.

### C. Multi-fixture & room depth (Stage 2 polish) — ⏳ partial
- [ ] More than one concurrent fixture (sim currently runs one match).
- [ ] Named rooms / shareable room links / invite a friend flow.
- [ ] Optional usernames / avatars in presence.
- [ ] Historical replay mode via `GET /api/scores/historical/{fixtureId}` for demo recording.

### D. Visualization polish (Stage 1/4 — the biggest scored lever) — ⏳ ongoing
- [ ] WebGL/shader upgrade option for richer fluid motion (current 2D canvas is solid baseline).
- [ ] Per-emotion visual signatures (rage = jagged red ruptures, hype = rising embers, etc.).
- [ ] "Moment replay" — scrub the emotional timeline of the match.
- [ ] Premium visual themes (a monetization hook).

### E. Production hardening & deploy (Stage 4/5) — ⏳ not started
- [ ] Deploy backend (Railway/Render/Fly) + web (Vercel) to **live public URLs** (hard requirement).
- [ ] Swap in-memory bus → Redis pub/sub if scaling for many concurrent rooms.
- [ ] Reconnection hardening end-to-end; pre-recorded fallback clip ready.
- [ ] Load-test the aggregator/fan-out under a real crowd.

### F. Submission package (Stage 5) — ⏳ not started
- [ ] Demo video (≤5 min): problem → live walkthrough → how TxLINE powers the backend.
- [ ] Public repo cleanup + technical docs (core idea, highlights, **list of TxLINE endpoints used**).
- [ ] Written feedback on the TxLINE API experience.
- [ ] Confirm exact prize per-place split with sponsor (source doc is inconsistent).

---

## 8. Submission checklist (hard requirements — auto-DQ if missed)

- [ ] Working **live** product (mainnet or devnet) — not a mockup
- [ ] Uses TxLINE data as a **live input**
- [ ] Sign up through **Solana**
- [x] **Public repo** structure ready (needs to be pushed/made public)
- [ ] **Demo video** (≤5 min)
- [ ] Working deployed URL OR functional API endpoint for judges
- [ ] Brief technical docs incl. list of TxLINE endpoints used
- [ ] Feedback on the TxLINE API experience
- [ ] Team ≤ 3 members, eligible via Superteam Earn

---

## 9. Recommended next moves (in order)

1. **Get live TxLINE access** (Section A) — it's the only blocker on the "live input"
   hard requirement, and it's ops not code. Do this in parallel with everything else.
2. **Deploy the current build to live URLs** (Section E) — we already have a complete,
   demoable product; getting it on a public URL de-risks the submission early.
3. **Multi-fixture + shareable rooms** (Section C) — makes the "together" story real.
4. **Visualization polish** (Section D) — the single biggest scored differentiator.
5. **On-chain verified moments** (Section B) — the originality crown, built last.
6. **Record the demo + submission package** (Section F).

> **Risk reminder:** the product is already a complete, original experience through
> Stage 2. Everything pending is additive. If time runs out, we still have something
> beautiful, live, and demoable — which is exactly how the architecture sequenced it.
