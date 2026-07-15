# PULSE — Product Plan, Goals & Build Status

**Last updated:** 2026-07-14
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

### Added 2026-07-14 (design pass + depth + the coherence fix)
- ✅ **Verified Replay** (`FEED_MODE=replay`, `server/src/txline/replay.ts`) — the
  fix for the "two disconnected worlds" problem (lively-but-fake sim goals vs one
  hardcoded real verifiable goal). Replays REAL fixture 17952170 (a genuine 1–1
  draw) scripted with its real milestones, each carrying a real `(seq, statKey)`
  proof tuple, so **every captured moment auto-verifies on Solana**. Verified live:
  a full loop → **3 moments, all 3 verified, 0 unverified**. Mechanics:
  `ScoreFrame.proof` → detector stamps goal/red events `provable` → `momentService`
  verifies on `provable || live`. `full_time` dropped from minted moments (it's a
  phase, no provable stat) so the rail is 100% verified. **This is now the best demo
  path — lively AND provable.** Real tuples: `(260,1002)` away goal, `(653,3006)`
  away red, `(687,3001)` home equaliser.
- ✅ **Multi-fixture sim** — 3 concurrent, time-offset scripted matches; the lobby is
  a real matchday card picker with live ticking scores.
- ✅ **Shareable room links** — `?join=<fixtureId>` deep link + ⚡ Invite (copy link).
- ✅ **Usernames** — optional chant name, persisted, floats up with your reactions.
- ✅ **Live presence** — count updates the instant someone joins/leaves.
- ✅ **UI redesign — stadium-night broadcast look** — Bebas Neue TV score bug,
  matchday lobby with pitch markings, glassy per-emotion reaction pads, lower-third
  ticker.
- ✅ **Per-emotion canvas signatures** — 🔥 hype embers · 🤬 rage shards · 😱 panic
  jitter · 🎉 cheer orbs, plus goal confetti cannons, floodlight sweeps, film grain.

**Mapping to stages:** Stage 1 ✅ · Stage 2 ✅ · Stage 3 ✅ (on-chain verified moments,
live on devnet; **Verified Replay** makes every watched moment provable) · Stage 4
simulated-crowd ✅ + visual polish ✅.

---

## 7. What is STILL PENDING

**The product is feature-complete.** Everything in the architecture is built and
verified end-to-end (emotion twin, rooms, on-chain moments, Verified Replay, the
redesign, and all the depth add-ons). What remains is the **submission / ops layer,
not code.** Four hard-requirement blockers, then optional polish.

### 🚨 Blockers (must clear to submit)

**1. Commit + push the code / public repo — ⛔ not done**
- [ ] The whole build is **uncommitted** (18 modified + 8 untracked files — the entire
      on-chain moments layer, Verified Replay, and the full redesign). Public-repo
      requirement can't be met until this is pushed. *Only chore, not code.*

**2. Deploy to live public URLs — ⛔ not started (only blocker needing real setup)**
- [ ] Backend → Railway / Render / Fly; web → Vercel. Judges need a working URL
      (auto-DQ risk otherwise). Set `VITE_SERVER_URL` on the web build + `CORS_ORIGIN`
      on the server.

**3. Demo video (≤5 min) — ⛔ not recorded**
- [ ] Script exists (`DEMO_SCRIPT.md`) but still points at **sim** mode — update it to
      the stronger **replay** flow (every moment verifies on camera), then record:
      problem → live walkthrough → how TxLINE powers the backend.

**4. TxLINE API feedback note — ⏳ partial**
- [ ] Gotchas currently live *inside* the README, not as the **standalone deliverable**
      the submission asks for. Extract them: IDL missing `validate_stat` `returns`;
      proof hashes as byte-arrays not hex; snake_case anchor args; `.view()` fee-payer
      must exist; devnet SL1-only + empty live SSE + empty historical.

> That's it for blockers — **4 things, and only #2 involves real setup work**; the rest
> is writing/committing.

### ⏳ Optional polish (additive — skip unless time before recording)
- [ ] **Real team names** for the replay fixture (currently the honest "Home/Away"; the
      devnet feed only exposes participant IDs 2999 / 1776). Set `REPLAY_HOME`/`REPLAY_AWAY`.
- [ ] **Richer moment card** — emotional peak curve + reaction breakdown + "Fan MVP".
- [ ] **Moment / emotional-timeline scrub**; **premium visual themes** (monetization hooks).
- [ ] **WebGL/shader upgrade** — *deliberately skipped*; the 2D canvas is already the safe,
      beautiful baseline and a rewrite this close to recording is pure demo risk.
- [ ] **Reconnection hardening + Redis pub/sub** — only matters at real scale; in-memory
      bus + current backoff are fine for the demo.
- [ ] Confirm exact prize per-place split with sponsor (source doc is inconsistent).

### ✅ Cleared since the last plan (were pending, now done)
- On-chain Verified Moments (Stage 3) — built & verified live on devnet 2026-07-08.
- Live TxLINE access — token in `server/.env`; real fixtures snapshot wired; `replay`
  mode discovers + proves real goals. (Devnet reality: SL1-only, live SSE + historical
  empty — so **replay** is the provable demo path, not live.)
- Multi-fixture, shareable room links, usernames, live presence, per-emotion visual
  signatures — all shipped 2026-07-14 (see §6).

---

## 8. Submission checklist (hard requirements — auto-DQ if missed)

- [x] Working **live** product (devnet) — end-to-end, not a mockup
- [x] Uses TxLINE data as a **live input** — real fixtures snapshot + live on-chain
      stat-validation Merkle proofs; **Verified Replay** proves real goals per moment
- [x] Sign up through **Solana** — on-chain subscribe + token activation on devnet
- [ ] **Public repo** — ⛔ code is uncommitted; commit + push (Blocker 1)
- [ ] **Demo video** (≤5 min) — ⛔ not recorded (Blocker 3)
- [ ] Working deployed URL OR functional API endpoint for judges — ⛔ not deployed (Blocker 2)
- [x] Brief technical docs incl. list of TxLINE endpoints used (README)
- [ ] Feedback on the TxLINE API experience — ⏳ in README, needs standalone note (Blocker 4)
- [ ] Team ≤ 3 members, eligible via Superteam Earn

---

## 9. Recommended next moves (in order)

Feature work is done; these are the four blockers, ordered to de-risk fastest.

1. **Commit + push the code** (Blocker 1) — makes the repo public and real. ~minutes.
2. **Deploy to live URLs** (Blocker 2) — the only item needing real setup; backend on
   Railway/Render + web on Vercel. Do early to de-risk the submission.
3. **Update `DEMO_SCRIPT.md` to replay mode + record the video** (Blocker 3).
4. **Extract the TxLINE API feedback note** (Blocker 4) — pull the gotchas out of the
   README into a standalone note.

Then, only if time remains, cherry-pick from the optional-polish list (§7).

> **Risk reminder:** the product is already a complete, original, verified experience —
> lively AND provable via Verified Replay. Everything pending is submission/ops, not
> code. If time runs out mid-polish, what ships is still beautiful, live, and demoable.
