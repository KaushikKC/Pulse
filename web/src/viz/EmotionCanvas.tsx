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
}

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
}

interface Shockwave {
  x: number;
  y: number;
  r: number;
  maxR: number;
  life: number;
  color: [number, number, number];
}

const PARTICLE_CAP = 520;

/**
 * The single living canvas — the room's collective emotion, *now*.
 *
 * Design goals (straight from the architecture):
 *  - Feels alive even in a quiet moment (idle "breathing").
 *  - Explodes on a goal / red card (shockwaves + particle bursts).
 *  - Tinted / split by which team each fan supports (left away, right home).
 *  - Built to look great in a 5-minute screen recording.
 *
 * Pure 2D canvas + additive blending — no WebGL dependency, runs anywhere.
 */
export function EmotionCanvas({ emotion, lastEvent, homeColor, awayColor }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Live values fed into the rAF loop without restarting it.
  const emotionRef = useRef<EmotionalState | null>(emotion);
  const seenEventRef = useRef<string | null>(null);
  const eventQueue = useRef<MatchEvent[]>([]);

  emotionRef.current = emotion;

  // Queue brand-new events for the loop to turn into bursts.
  useEffect(() => {
    if (lastEvent && lastEvent.id !== seenEventRef.current) {
      seenEventRef.current = lastEvent.id;
      eventQueue.current.push(lastEvent);
    }
  }, [lastEvent]);

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
      const color = dominantColor(e, side, home, away);
      // Bias spawn x by side so the field visibly splits home/away.
      const baseX = side > 0 ? w * 0.62 : side < 0 ? w * 0.38 : w * 0.5;
      const spread = w * 0.28;
      particles.push({
        x: baseX + (Math.random() - 0.5) * spread,
        y: h + 12,
        vx: (Math.random() - 0.5) * 0.4,
        vy: -(0.4 + Math.random() * 1.6) * (0.6 + energy * 2.2),
        life: 0,
        maxLife: 120 + Math.random() * 160,
        size: 8 + Math.random() * 26 * (0.6 + energy),
        color,
        side,
      });
    }

    function burst(ev: MatchEvent, w: number, h: number) {
      const side = ev.team === 1 ? 1 : ev.team === 2 ? -1 : 0;
      const cx = side > 0 ? w * 0.68 : side < 0 ? w * 0.32 : w * 0.5;
      const cy = h * 0.5;
      const color = eventColor(ev, home, away);

      shockwaves.push({
        x: cx,
        y: cy,
        r: 0,
        maxR: Math.max(w, h) * (0.5 + ev.intensity * 0.6),
        life: 0,
        color,
      });
      flash = Math.min(1, flash + ev.intensity * 0.9);
      energy = Math.min(1, energy + ev.intensity * 0.8);

      const count = Math.round(40 + ev.intensity * 180);
      for (let i = 0; i < count && particles.length < PARTICLE_CAP + 200; i++) {
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
        });
      }
    }

    function frame() {
      t += 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const e = emotionRef.current;
      const target = e ? e.intensity : 0.1;
      energy += (target - energy) * 0.06;

      // Drain queued match events into bursts.
      let ev: MatchEvent | undefined;
      while ((ev = eventQueue.current.shift())) burst(ev, w, h);

      // --- background: deep breathing gradient tinted by crowd tilt ----------
      const tilt = e?.tilt ?? 0;
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
      bg.addColorStop(1, "rgba(5,6,10,1)");
      ctx.fillStyle = "rgb(5,6,10)";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // Subtle center divide so the home/away split reads clearly.
      ctx.fillStyle = "rgba(255,255,255,0.025)";
      ctx.fillRect(w * 0.5 - 1, 0, 2, h);

      // --- particles (additive) ---------------------------------------------
      ctx.globalCompositeOperation = "lighter";
      const spawnRate = Math.round(1 + energy * 7);
      for (let i = 0; i < spawnRate; i++) spawnAmbient(w, h);

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life += 1;
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.012; // gentle gravity
        p.vx *= 0.992;
        p.vy *= 0.992;
        const k = 1 - p.life / p.maxLife;
        if (k <= 0 || p.y < -40) {
          particles.splice(i, 1);
          continue;
        }
        const alpha = Math.sin(Math.min(1, k) * Math.PI) * 0.5;
        const r = p.size * (0.6 + k * 0.7);
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        g.addColorStop(0, rgba(p.color, alpha));
        g.addColorStop(1, rgba(p.color, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
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
      raf = requestAnimationFrame(frame);
    }

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [homeColor, awayColor]);

  return <canvas ref={canvasRef} className="emotion-canvas" />;
}

// --- color helpers ----------------------------------------------------------

type RGB = [number, number, number];

function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgba([r, g, b]: RGB, a: number): string {
  return `rgba(${r | 0},${g | 0},${b | 0},${a})`;
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

/** Blend the team tint with the dominant *emotion* color for this side. */
function dominantColor(e: EmotionalState | null, side: number, home: RGB, away: RGB): RGB {
  const teamTint = side > 0 ? home : away;
  if (!e) return teamTint;
  const counts = side > 0 ? e.byTeam[1] : e.byTeam[2];
  let best: ReactionType = "cheer";
  let bestN = -1;
  (Object.keys(counts) as ReactionType[]).forEach((k) => {
    if (counts[k] > bestN) {
      bestN = counts[k];
      best = k;
    }
  });
  if (bestN <= 0) return teamTint;
  return mix(teamTint, hexToRgb(REACTION_META[best].color), 0.55);
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
