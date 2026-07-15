# PULSE — Demo Video Walkthrough

## Pre-flight (already done for you, but to restart later)

```bash
cd Pulse
FEED_MODE=sim npm run dev      # sim = lively match; token in .env still enables on-chain verify
```

Wait for `web` on http://localhost:5173. Optional sanity check in a terminal:
`curl localhost:4000/health` → should show `"feedMode":"sim","onChainVerify":true`.

> **Why sim mode:** the devnet live SSE scores stream is empty (fixtures are only
> *scheduled*), so real goals never arrive on demand. Sim mode replays a dramatic
> Argentina–France final so the screen actually erupts on camera — while the
> on-chain verification below still runs against **real** devnet proofs.

---

## The demo, scene by scene

### Scene 1 — The hook (Lobby) · ~10s
1. Open http://localhost:5173 in a clean browser window.
2. You'll see the **PULSE** brand and *"Pick your side for Argentina vs France."*
3. Say the one-liner: *"PULSE is a shared second screen — you feel a match together, and the biggest moments get verified on Solana."*

### Scene 2 — Join & the living canvas · ~15s
4. Click **Argentina** (a side). The lobby drops into the room: the **living canvas** breathing, the **scoreboard** up top, the **reaction bar** at the bottom.
5. Point out it's calm/breathing when the match is quiet — *"this is the room's collective emotion, right now."*

### Scene 3 — "Together" (the fusion) · ~15s
6. Open a **second browser tab/window** to the same URL, pick **France** this time.
7. In each tab, **tap the reaction buttons** (🎉 Cheer / 🔥 Hype / 😱 Panic / 🤬 Rage). Emoji floaters rise on your side; the canvas tints toward whichever crowd is louder.
8. Line: *"Two fans, two sides, fusing into one canvas — the emotion is collective, not solitary."*

### Scene 4 — A real event erupts · ~15s
9. Keep the room open through the looping match. When the sim **scores a goal / shows a red card**, the canvas **flashes and shockwaves**, the **event ticker** shows `GOAL — …`, and the scoreboard ticks up.
10. Line: *"The screen reacts within about a second of the on-pitch event — this is the TxLINE feed driving the visualization."*

### Scene 5 — A moment is captured · ~10s
11. ~1 second after the goal, a chip appears in the **MOMENTS** rail (top of the overlay) showing the scoreline.
12. Click the chip → the **shareable poster** opens (score, event, the crowd's **emotional peak %**). Click **Save image** to show it downloads.
13. Line: *"Every peak becomes a collectible moment — machine truth locked to human feeling."*

### Scene 6 — The differentiator: verified on Solana · ~20s (the money shot)
14. Click **"⛓ Verify a real goal on-chain."** It shows *"Verifying on Solana…"* then opens a card badged **✓ Verified on Solana**.
15. Click **"View daily-root account ↗"** — it opens Solana Explorer (devnet) on the real `daily_scores_roots` PDA.
16. Line: *"This isn't cosmetic — PULSE pulled the goal's Merkle proof from TxLINE and validated it on-chain against the daily root Solana published. A tampered proof is rejected."*

### Scene 7 — Close · ~5s
17. Return to the room, tap a few more reactions so it ends on a lively canvas. One-line vision close: *"The emotional layer for live sports — social, visual, and ownable."*

---

## Recording tips

- **Two windows side-by-side** for Scene 3 sells "together" instantly.
- Do a **dry run once** so you know roughly when the sim goal fires, then record.
- Keep it **under 5 minutes** — Scenes 1–2 fast, linger on **Scene 6** (the on-chain proof) since that's your originality score.
- Optional polish: to show real team names on the verified card, add `DEMO_HOME=…` / `DEMO_AWAY=…` to `server/.env` (only if you know fixture `17952170`'s teams — otherwise leave the honest "Home/Away").
