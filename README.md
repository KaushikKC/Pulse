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
- **On-chain verified moments** — the biggest emotional peaks are snapshotted as collectible
  "moments" and cryptographically verified on **Solana devnet**: PULSE fetches the stat's
  Merkle proof from TxLINE and validates it against the published `daily_scores_roots` root
  via the program's `validate_stat` view. Verified moments render as a shareable poster with
  a "✓ Verified on Solana" badge and an explorer link. *Confirmed live: a real goal proof
  returns `valid:true`; a tampered proof is rejected.*

### On-chain verified moments — how it works

```
milestone event (goal/red/full-time)          GET /api/scores/stat-validation
        │  peak intensity snapshot                    │  Merkle proof (byte-array nodes)
        ▼                                             ▼
  momentService.ts  ───────────────────▶  validation.ts  ──▶  program.validate_stat(...).view()
        │  emit verified_moment                              against daily_scores_roots PDA on Solana
        ▼
  Socket.IO ─▶ MomentCard (shareable poster + ✓ Verified badge + explorer link)
```

- The `.view()` is a read-only simulation — **no funded wallet or signature needed** to verify
  (simulation reuses the subscribe wallet as the fee payer, since the payer must exist on-chain).
- Try it without a live goal: `GET /api/moments/demo`, or the **"⛓ Verify a real goal on-chain"**
  button in the app — both verify a known real devnet goal end-to-end.

**Implementation notes / TxLINE API feedback (from getting this working on devnet):**
- The published IDL omits `validate_stat`'s `returns` type, so anchor won't build a `.view()`
  for it — we patch `returns: "bool"` into the IDL in memory (`program.ts`).
- The `stat-validation` response returns hashes as **byte arrays** (not the hex the docs
  example implies) and `statToProve` as an object `{ key, value, period }`.
- Anchor 0.30 encodes struct args by their **snake_case** IDL field names.
- `import * as anchor` does **not** surface anchor's re-exported `BN` under tsx/esbuild — use
  the default import (`import anchor from "@coral-xyz/anchor"; const { BN } = anchor`).

Still to come (per the build plan): deploy to a public URL and record the demo video. The
live SSE scores stream is empty on devnet (fixtures are scheduled), so goal-driven auto-moments
show best in simulated mode; the on-chain verification runs against real devnet proofs.

## Run it

```bash
npm install          # installs all workspaces
npm run dev          # server :4000 + web :5173 (concurrently)
```

Open http://localhost:5173 — pick a side and start tapping. Open a second tab to
feel two fans fuse into one canvas. Runs with **no credentials** in simulated mode.

### Switch to the live TxLINE feed (devnet — free)

One-time wallet setup, then one command does the whole subscribe → activate flow:

```bash
# 1. A funded Solana devnet wallet (free)
solana-keygen new --outfile ~/pulse-devnet.json
solana config set --url devnet
solana airdrop 2

# 2. Config
cp server/.env.example server/.env
#    set TXLINE_WALLET_KEYPAIR=~/pulse-devnet.json  (NETWORK=devnet is the default)

# 3. Subscribe (Service Level 12, real-time, no TxL tokens) + activate the API token
npm run setup:txline -w @pulse/server
#    → prints FEED_MODE=live / TXLINE_JWT / TXLINE_API_TOKEN — paste them into server/.env

# 4. Run live
npm run dev
```

The flow (from the TxLINE World Cup docs):
`POST /auth/guest/start` → `program.subscribe(12, 4 weeks)` on the devnet program
`6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J` → `POST /api/token/activate`
(signs `txSig:leagues:jwt` with the wallet). Devnet API base is
`https://txline-dev.txodds.com`. The onboarding script is
`server/src/txline/onboarding.ts`; live SSE payload mapping is `server/src/txline/ingest.ts`.

## Layout

| Path | What |
| --- | --- |
| `shared/` | Protocol types + constants shared by server and web (single source of truth) |
| `server/` | Ingest, event detector, in-memory bus, Socket.IO fan-out, reaction aggregator, simulator, **moments (on-chain verification)** |
| `web/` | React + 2D-canvas client — the living visualization, reaction bar, event ticker, **moment cards** |

## PULSE HTTP endpoints (for judges)

| Purpose | Endpoint |
| --- | --- |
| Health / status | `GET /health` |
| Joinable fixtures | `GET /api/fixtures` |
| Verify a specific stat on-chain | `POST /api/moments/verify` `{ fixtureId, seq, statKey }` |
| Verify the demo real goal on-chain | `GET /api/moments/demo` |

## TxLINE endpoints used

| Purpose | Endpoint |
| --- | --- |
| Guest auth | `POST /auth/guest/start` |
| Token activation | `POST /api/token/activate` |
| Match list | `GET /api/fixtures/snapshot` |
| Live scores | `GET /api/scores/stream` (SSE) |
| Live odds | `GET /api/odds/stream` (SSE) |
| **Moment proof (verified moments)** | `GET /api/scores/stat-validation?fixtureId=&seq=&statKey=` |
| On-chain subscribe | `program.subscribe(...)` (devnet program `6pW64…wyP2J`) |
| On-chain validate | `program.validate_stat(...).view()` vs `daily_scores_roots` PDA |
