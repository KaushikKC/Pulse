import { useEffect, useRef } from "react";
import {
  REACTION_META,
  type EmotionalState,
  type MatchEvent,
  type ReactionType,
} from "@pulse/shared";

interface Props {
  emotion: EmotionalState | null;
  lastEvent: MatchEvent | null;
  homeColor: string;
  awayColor: string;
  /** Deep canvas base color (theme-driven). */
  bgColor?: string;
  /** Stadium-floodlight tint (theme-driven). */
  lightColor?: string;
  /**
   * Timeline "review" mode: when set (the fan is scrubbing), the canvas drives its
   * energy + tilt from this snapshot instead of the live emotion — reliving that
   * instant of the match. Null = follow live.
   */
  override?: { intensity: number; tilt: number } | null;
  /** A one-shot event to re-burst (e.g. scrubbing back across a goal). */
  burstEvent?: MatchEvent | null;
}

type Shape = "orb" | "ember" | "shard" | "confetti";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: [number, number, number];
  side: number; // -1 away, 0 neutral, +1 home
  shape: Shape;
  /** Which emotion spawned it — drives the per-emotion motion signature. */
  kind: ReactionType | null;
  rot: number;
  vrot: number;
  /** Random phase for wobble / flicker so particles don't move in lockstep. */
  ph: number;
}

interface Shockwave {
  x: number;
  y: number;
  r: number;
  maxR: number;
  life: number;
  color: [number, number, number];
}

const PARTICLE_CAP = 620;

/**
 * The single living canvas — the room's collective emotion, *now*.
 *
 * Design goals (straight from the architecture):
 *  - Feels alive even in a quiet moment (idle "breathing" + floodlight sweeps).
 *  - Explodes on a goal / red card (shockwaves + bursts + team-color confetti).
 *  - Tinted / split by which team each fan supports (left away, right home).
 *  - Every emotion has its own visual signature:
 *      🎉 cheer → soft rising orbs   🔥 hype → flickering embers
 *      😱 panic → jittery wobble     🤬 rage → jagged red shards
 *  - Built to look great in a 5-minute screen recording.
 *
 * Pure 2D canvas + additive blending — no WebGL dependency, runs anywhere.
 */
export function EmotionCanvas({
  emotion,
  lastEvent,
  homeColor,
  awayColor,
  bgColor = "#04050b",
  lightColor = "#bed2ff",
  override,
  burstEvent,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Live values fed into the rAF loop without restarting it.
  const emotionRef = useRef<EmotionalState | null>(emotion);
  const overrideRef = useRef(override);
  const seenEventRef = useRef<string | null>(null);
  const seenBurstRef = useRef<string | null>(null);
  const eventQueue = useRef<MatchEvent[]>([]);

  emotionRef.current = emotion;
  overrideRef.current = override;

  // Queue brand-new events for the loop to turn into bursts.
  useEffect(() => {
    if (lastEvent && lastEvent.id !== seenEventRef.current) {
      seenEventRef.current = lastEvent.id;
      eventQueue.current.push(lastEvent);
    }
  }, [lastEvent]);

  // Re-burst when scrubbing back across a moment.
  useEffect(() => {
    if (burstEvent && burstEvent.id !== seenBurstRef.current) {
      seenBurstRef.current = burstEvent.id;
      eventQueue.current.push(burstEvent);
    }
  }, [burstEvent]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d", { alpha: false })!;
    const particles: Particle[] = [];
    const shockwaves: Shockwave[] = [];
    let raf = 0;
    let t = 0;
    /** Smoothed energy so the canvas eases instead of strobing. */
    let energy = 0.12;
    let flash = 0;

    const home = hexToRgb(homeColor);
    const away = hexToRgb(awayColor);
    const base = hexToRgb(bgColor);
    const light = hexToRgb(lightColor);

    // Pre-render a film-grain tile once — the "shot on broadcast camera" texture.
    const grainTile = document.createElement("canvas");
    grainTile.width = grainTile.height = 160;
    {
      const g = grainTile.getContext("2d")!;
      const img = g.createImageData(160, 160);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = 110 + Math.random() * 70;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = Math.random() * 40;
      }
      g.putImageData(img, 0, 0);
    }
    const grain = ctx.createPattern(grainTile, "repeat")!;

    function resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener("resize", resize);

    function spawnAmbient(w: number, h: number) {
      if (particles.length >= PARTICLE_CAP) return;
      const e = emotionRef.current;
      const side = pickSide(e);
      const { kind, color } = dominantEmotion(e, side, home, away);
      // Bias spawn x by side so the field visibly splits home/away.
      const baseX = side > 0 ? w * 0.62 : side < 0 ? w * 0.38 : w * 0.5;
      const spread = w * 0.28;

      const shape: Shape = kind === "hype" ? "ember" : kind === "rage" ? "shard" : "orb";
      const lift = kind === "hype" ? 1.5 : kind === "rage" ? 2.1 : 1;
      particles.push({
        x: baseX + (Math.random() - 0.5) * spread,
        y: h + 12,
        vx: (Math.random() - 0.5) * (kind === "panic" ? 1.3 : 0.4),
        vy: -(0.4 + Math.random() * 1.6) * (0.6 + energy * 2.2) * lift,
        life: 0,
        maxLife:
          shape === "shard" ? 60 + Math.random() * 70 : 120 + Math.random() * 160,
        size:
          shape === "ember"
            ? 3 + Math.random() * 8
            : shape === "shard"
              ? 10 + Math.random() * 18
              : 8 + Math.random() * 26 * (0.6 + energy),
        color,
        side,
        shape,
        kind,
        rot: 0,
        vrot: 0,
        ph: Math.random() * Math.PI * 2,
      });
    }

    function burst(ev: MatchEvent, w: number, h: number) {
      const side = ev.team === 1 ? 1 : ev.team === 2 ? -1 : 0;
      const cx = side > 0 ? w * 0.68 : side < 0 ? w * 0.32 : w * 0.5;
      const cy = h * 0.5;
      const color = eventColor(ev, home, away);

      // Double shockwave: a tight bright ring inside a huge soft one.
      shockwaves.push({
        x: cx,
        y: cy,
        r: 0,
        maxR: Math.max(w, h) * (0.5 + ev.intensity * 0.6),
        life: 0,
        color,
      });
      shockwaves.push({
        x: cx,
        y: cy,
        r: 0,
        maxR: Math.max(w, h) * (0.28 + ev.intensity * 0.3),
        life: 0,
        color: [255, 255, 255],
      });
      flash = Math.min(1, flash + ev.intensity * 0.9);
      energy = Math.min(1, energy + ev.intensity * 0.8);

      const count = Math.round(40 + ev.intensity * 170);
      for (let i = 0; i < count && particles.length < PARTICLE_CAP + 220; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = (1 + Math.random() * 7) * (0.5 + ev.intensity);
        particles.push({
          x: cx,
          y: cy,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp - 1,
          life: 0,
          maxLife: 70 + Math.random() * 90,
          size: 6 + Math.random() * 22,
          color,
          side,
          shape: "orb",
          kind: null,
          rot: 0,
          vrot: 0,
          ph: Math.random() * Math.PI * 2,
        });
      }

      // Goals & full time get a team-color confetti cannon.
      if (ev.type === "goal" || ev.type === "full_time") {
        const palette: [number, number, number][] = [
          color,
          [255, 255, 255],
          mix(color, [255, 255, 255], 0.5),
        ];
        const n = Math.round(50 + ev.intensity * 70);
        for (let i = 0; i < n && particles.length < PARTICLE_CAP + 320; i++) {
          particles.push({
            x: cx + (Math.random() - 0.5) * 60,
            y: cy,
            vx: (Math.random() - 0.5) * 8,
            vy: -(2 + Math.random() * 6.5),
            life: 0,
            maxLife: 130 + Math.random() * 90,
            size: 3 + Math.random() * 5,
            color: palette[i % palette.length],
            side,
            shape: "confetti",
            kind: null,
            rot: Math.random() * Math.PI,
            vrot: (Math.random() - 0.5) * 0.35,
            ph: Math.random() * Math.PI * 2,
          });
        }
      }
    }

    /** Slow-sweeping stadium floodlight beams from the top corners. */
    function floodlights(w: number, h: number) {
      for (let i = 0; i < 2; i++) {
        const cx = i === 0 ? w * 0.16 : w * 0.84;
        const sway = Math.sin(t * 0.006 + i * 2.4) * 0.22 + (i === 0 ? 0.3 : -0.3);
        ctx.save();
        ctx.translate(cx, -40);
        ctx.rotate(sway);
        const grad = ctx.createLinearGradient(0, 0, 0, h * 1.25);
        const a = 0.03 + energy * 0.05;
        grad.addColorStop(0, rgba(light, a));
        grad.addColorStop(1, rgba(light, 0));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-w * 0.1, h * 1.25);
        ctx.lineTo(w * 0.1, h * 1.25);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }

    function frame() {
      t += 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const e = emotionRef.current;
      const ov = overrideRef.current;
      // While reviewing the timeline, drive energy/tilt from the scrubbed instant.
      const target = ov ? ov.intensity : e ? e.intensity : 0.1;
      // Snap faster when scrubbing so dragging feels responsive.
      energy += (target - energy) * (ov ? 0.18 : 0.06);

      // Drain queued match events into bursts.
      let ev: MatchEvent | undefined;
      while ((ev = eventQueue.current.shift())) burst(ev, w, h);

      // --- background: deep breathing gradient tinted by crowd tilt ----------
      const tilt = ov ? ov.tilt : e?.tilt ?? 0;
      const breathe = 0.5 + Math.sin(t * 0.02) * 0.5;
      const bg = ctx.createRadialGradient(
        w * (0.5 + tilt * 0.18),
        h * 0.5,
        0,
        w * 0.5,
        h * 0.5,
        Math.max(w, h) * (0.55 + energy * 0.25),
      );
      const glow = mix(home, away, (1 - tilt) / 2);
      const a0 = 0.08 + energy * 0.22 + breathe * 0.04;
      bg.addColorStop(0, rgba(glow, a0));
      bg.addColorStop(0.5, rgba(glow, a0 * 0.35));
      bg.addColorStop(1, rgba(base, 1));
      ctx.fillStyle = rgba(base, 1);
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // Subtle center divide so the home/away split reads clearly.
      ctx.fillStyle = "rgba(255,255,255,0.025)";
      ctx.fillRect(w * 0.5 - 1, 0, 2, h);

      // --- everything luminous is additive ----------------------------------
      ctx.globalCompositeOperation = "lighter";
      floodlights(w, h);

      const spawnRate = Math.round(1 + energy * 7);
      for (let i = 0; i < spawnRate; i++) spawnAmbient(w, h);

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life += 1;

        // --- motion, per emotion signature ---
        if (p.shape === "ember") {
          p.vy *= 1.006; // embers accelerate as they climb
          p.vx *= 0.99;
        } else if (p.shape === "confetti") {
          p.vy += 0.055; // real gravity — confetti falls
          p.vx *= 0.992;
          p.rot += p.vrot;
          p.x += Math.sin(p.life * 0.18 + p.ph) * 0.7; // flutter
        } else {
          p.vy += 0.012; // gentle gravity
          p.vx *= 0.992;
          p.vy *= 0.992;
        }
        if (p.kind === "panic") {
          p.x += Math.sin(p.life * 0.32 + p.ph) * 1.1; // nervous jitter
        }
        p.x += p.vx;
        p.y += p.vy;

        const k = 1 - p.life / p.maxLife;
        if (k <= 0 || p.y < -40 || p.y > h + 60) {
          particles.splice(i, 1);
          continue;
        }

        // --- render, per shape ---
        let alpha = Math.sin(Math.min(1, k) * Math.PI) * 0.5;
        if (p.shape === "ember") {
          alpha *= 0.65 + 0.35 * Math.sin(p.life * 0.7 + p.ph); // flicker
          const r = p.size * (0.8 + k * 0.6);
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2.4);
          g.addColorStop(0, rgba([255, 240, 200], alpha));
          g.addColorStop(0.35, rgba(p.color, alpha * 0.8));
          g.addColorStop(1, rgba(p.color, 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r * 2.4, 0, Math.PI * 2);
          ctx.fill();
        } else if (p.shape === "shard") {
          // Jagged rage streak drawn along the velocity vector.
          const len = p.size * 1.6;
          const nx = p.x - p.vx * len * 0.4;
          const ny = p.y - p.vy * len * 0.4;
          ctx.strokeStyle = rgba(p.color, alpha * 0.5);
          ctx.lineWidth = 5;
          ctx.beginPath();
          ctx.moveTo(nx, ny);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          ctx.strokeStyle = rgba([255, 235, 235], alpha);
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(nx, ny);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        } else if (p.shape === "confetti") {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          // Fold shimmer: scale one axis with rotation so it glints like paper.
          const fold = 0.3 + Math.abs(Math.sin(p.life * 0.15 + p.ph)) * 0.7;
          ctx.fillStyle = rgba(p.color, alpha * 1.6);
          ctx.fillRect(-p.size, -p.size * fold, p.size * 2, p.size * fold * 2);
          ctx.restore();
        } else {
          const r = p.size * (0.6 + k * 0.7);
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
          g.addColorStop(0, rgba(p.color, alpha));
          g.addColorStop(1, rgba(p.color, 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // --- shockwaves --------------------------------------------------------
      for (let i = shockwaves.length - 1; i >= 0; i--) {
        const s = shockwaves[i];
        s.life += 1;
        s.r += (s.maxR - s.r) * 0.06;
        const k = 1 - s.r / s.maxR;
        if (k <= 0.02) {
          shockwaves.splice(i, 1);
          continue;
        }
        ctx.strokeStyle = rgba(s.color, k * 0.5);
        ctx.lineWidth = 2 + k * 10;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.stroke();
      }

      // --- full-screen flash on a big event ---------------------------------
      if (flash > 0.001) {
        ctx.fillStyle = `rgba(255,255,255,${flash * 0.35})`;
        ctx.fillRect(0, 0, w, h);
        flash *= 0.9;
      }

      ctx.globalCompositeOperation = "source-over";

      // --- film grain + vignette: the broadcast-camera finish ---------------
      ctx.save();
      ctx.globalAlpha = 0.05;
      ctx.translate(((t * 7) % 160) - 160, ((t * 13) % 160) - 160);
      ctx.fillStyle = grain;
      ctx.fillRect(0, 0, w + 320, h + 320);
      ctx.restore();

      const vig = ctx.createRadialGradient(
        w * 0.5,
        h * 0.5,
        Math.min(w, h) * 0.45,
        w * 0.5,
        h * 0.5,
        Math.max(w, h) * 0.75,
      );
      vig.addColorStop(0, "rgba(0,0,0,0)");
      vig.addColorStop(1, "rgba(0,0,0,0.42)");
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, w, h);

      raf = requestAnimationFrame(frame);
    }

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [homeColor, awayColor, bgColor, lightColor]);

  return <canvas ref={canvasRef} className="emotion-canvas" />;
}

// --- color helpers ----------------------------------------------------------

type RGB = [number, number, number];

function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgba([r, g, b]: RGB, a: number): string {
  return `rgba(${r | 0},${g | 0},${b | 0},${Math.min(1, a)})`;
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Pick which side a new ambient particle belongs to, weighted by reactions. */
function pickSide(e: EmotionalState | null): number {
  if (!e) return Math.random() < 0.5 ? 1 : -1;
  const home = sumSide(e, 1);
  const away = sumSide(e, 2);
  const total = home + away;
  if (total === 0) return Math.random() < 0.5 ? 1 : -1;
  return Math.random() < home / total ? 1 : -1;
}

/**
 * The dominant *emotion* on this side right now — both its color (blended with
 * the team tint) and its type, which selects the particle's visual signature.
 */
function dominantEmotion(
  e: EmotionalState | null,
  side: number,
  home: RGB,
  away: RGB,
): { kind: ReactionType | null; color: RGB } {
  const teamTint = side > 0 ? home : away;
  if (!e) return { kind: null, color: teamTint };
  const counts = side > 0 ? e.byTeam[1] : e.byTeam[2];
  let best: ReactionType = "cheer";
  let bestN = -1;
  (Object.keys(counts) as ReactionType[]).forEach((k) => {
    if (counts[k] > bestN) {
      bestN = counts[k];
      best = k;
    }
  });
  if (bestN <= 0) return { kind: null, color: teamTint };
  return { kind: best, color: mix(teamTint, hexToRgb(REACTION_META[best].color), 0.55) };
}

function eventColor(ev: MatchEvent, home: RGB, away: RGB): RGB {
  if (ev.type === "goal") return ev.team === 1 ? home : away;
  if (ev.type === "red_card") return hexToRgb(REACTION_META.rage.color);
  if (ev.type === "momentum_swing") return hexToRgb(REACTION_META.hype.color);
  return [255, 255, 255];
}

const sumSide = (e: EmotionalState, side: 1 | 2) => {
  const c = e.byTeam[side];
  return c.cheer + c.panic + c.rage + c.hype;
};
