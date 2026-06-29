# PULSE

A shared live **second screen** where you and your friends react to a World Cup
match together. Your collective emotion is fused with real on-pitch data from the
**TxLINE** feed into one living visualization — and the biggest emotional peaks can
be minted as cryptographically verifiable on-chain moments.

> Consumer & Fan Experiences track — TxODDS World Cup Hackathon (Solana).
> Nothing here is a market or a payout. The value is emotional, social, expressive.

## What's built so far

The end-to-end **emotion-twin + room** core:

```
TxLINE SSE  ─▶  ingest  ─▶  event detector  ─▶  in-memory bus  ─▶  Socket.IO fan-out  ─▶  browsers
(or simulator)   (1 conn)   (goal/card/phase/    (decouples)        (rooms by fixtureId)    (living canvas)
                            momentum diffing)                       reaction aggregator ◀── tap reactions
```

- **One connection in, many out** — browsers never touch TxLINE directly.
- **Event detector** diffs feed frames → `goal / red_card / yellow_card / phase_change / momentum_swing / full_time`.
- **Reaction aggregator** fuses taps in 250 ms windows into one "emotional state" per room.
- **The hero canvas** breathes when quiet, splits home/away by supporter, and erupts in shockwaves on a real goal.
- **Simulated crowd mode** (default) replays a dramatic match + synthetic reactions, so the demo always looks alive with no live fixture.

Still to come (per the build plan): the on-chain "verified moments" layer
(`/api/scores/stat-validation` → Solana `validateStat`), and the live TxLINE
subscription via Solana Service Level 12.

## Run it

```bash
npm install          # installs all workspaces
npm run dev          # server :4000 + web :5173 (concurrently)
```

Open http://localhost:5173 — pick a side and start tapping. Open a second tab to
feel two fans fuse into one canvas. Runs with **no credentials** in simulated mode.

### Switch to the live TxLINE feed

```bash
cp server/.env.example server/.env
# set FEED_MODE=live and fill TXLINE_JWT + TXLINE_API_TOKEN
```

The token comes from the documented flow: `POST /auth/guest/start` → subscribe
on Solana to **Service Level 12** (World Cup + Int Friendlies, real-time) →
`POST /api/token/activate`. Payload mapping lives in `server/src/txline/ingest.ts`.

## Layout

| Path | What |
| --- | --- |
| `shared/` | Protocol types + constants shared by server and web (single source of truth) |
| `server/` | Ingest, event detector, in-memory bus, Socket.IO fan-out, reaction aggregator, simulator |
| `web/` | React + 2D-canvas client — the living visualization, reaction bar, event ticker |

## TxLINE endpoints (planned/used)

| Purpose | Endpoint |
| --- | --- |
| Live scores | `GET /api/scores/stream` (SSE) |
| Live odds | `GET /api/odds/stream` (SSE) |
| Match list | `GET /api/fixtures/snapshot` |
| Backfill on join | `GET /api/scores/snapshot/{fixtureId}` |
| Historical replay | `GET /api/scores/historical/{fixtureId}` |
| Moment proof | `GET /api/scores/stat-validation?fixtureId=&seq=&statKey=` |
