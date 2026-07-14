import { REACTION_META, REACTIONS, type VerifiedMoment } from "@pulse/shared";

/**
 * Render a moment as a shareable 1080×1350 poster on a canvas — no external
 * libraries, so it works anywhere and in a screen recording. The image is the
 * collectible: score, event, the crowd's emotional peak, and (when present) the
 * Solana verification badge with the daily-root PDA.
 */
export function drawMomentPoster(
  canvas: HTMLCanvasElement,
  moment: VerifiedMoment,
  homeColor: string,
  awayColor: string,
  bgColor = "#05060f",
): void {
  const W = 1080;
  const H = 1350;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  const verified = moment.verification.status === "verified";
  const accent = moment.team === 2 ? awayColor : moment.team === 1 ? homeColor : "#a78bfa";

  // Background — deep gradient from a lifted tint of the theme base to the base.
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, lighten(bgColor, 0.06));
  bg.addColorStop(1, bgColor);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const glow = ctx.createRadialGradient(W / 2, H * 0.42, 60, W / 2, H * 0.42, 720);
  glow.addColorStop(0, hexA(accent, 0.35 + moment.intensity * 0.35));
  glow.addColorStop(1, hexA(accent, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Brand.
  ctx.textAlign = "center";
  ctx.fillStyle = "#e8ecff";
  ctx.font = "400 62px Anton, sans-serif";
  ctx.fillText("PULSE", W / 2, 130);
  ctx.fillStyle = hexA("#e8ecff", 0.55);
  ctx.font = "600 26px Manrope, sans-serif";
  ctx.fillText("A MOMENT THAT MATTERED", W / 2, 175);

  // Event headline.
  ctx.fillStyle = accent;
  ctx.font = "400 84px Anton, sans-serif";
  wrapText(ctx, moment.label.toUpperCase(), W / 2, 340, W - 160, 92);

  // Scoreline.
  ctx.fillStyle = "#f4f6ff";
  ctx.font = "400 205px Anton, sans-serif";
  ctx.fillText(`${moment.score[0]}–${moment.score[1]}`, W / 2, 700);

  // Teams.
  ctx.font = "800 40px Manrope, sans-serif";
  ctx.fillStyle = homeColor;
  ctx.textAlign = "right";
  ctx.fillText(truncate(moment.participants[0], 16), W / 2 - 40, 770);
  ctx.fillStyle = awayColor;
  ctx.textAlign = "left";
  ctx.fillText(truncate(moment.participants[1], 16), W / 2 + 40, 770);
  ctx.textAlign = "center";

  if (moment.minute != null) {
    ctx.fillStyle = hexA("#e8ecff", 0.6);
    ctx.font = "600 34px Manrope, sans-serif";
    ctx.fillText(`${moment.minute}'`, W / 2, 830);
  }

  // Emotional surge — the curve of the crowd's intensity around the moment. Falls
  // back to a peak meter when no curve was captured (e.g. the demo moment).
  const chartX = 130;
  const chartW = W - 260;
  const chartTop = 878;
  const chartH = 110;
  ctx.fillStyle = hexA("#e8ecff", 0.5);
  ctx.font = "800 26px Manrope, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("CROWD EMOTIONAL SURGE", chartX, chartTop - 22);
  ctx.textAlign = "right";
  ctx.fillText(`${Math.round(moment.intensity * 100)}% PEAK`, chartX + chartW, chartTop - 22);

  const curve = moment.curve ?? [];
  if (curve.length >= 2) {
    drawArea(ctx, curve, chartX, chartTop, chartW, chartH, accent);
  } else {
    // Flat meter fallback.
    const barY = chartTop + chartH - 26;
    roundRect(ctx, chartX, barY, chartW, 26, 13);
    ctx.fillStyle = hexA("#ffffff", 0.1);
    ctx.fill();
    roundRect(ctx, chartX, barY, Math.max(26, chartW * moment.intensity), 26, 13);
    const meter = ctx.createLinearGradient(chartX, 0, chartX + chartW, 0);
    meter.addColorStop(0, homeColor);
    meter.addColorStop(1, awayColor);
    ctx.fillStyle = meter;
    ctx.fill();
  }

  // Reaction breakdown + Fan MVP.
  let rowY = chartTop + chartH + 46;
  const reactions = moment.reactions;
  const active = reactions ? REACTIONS.filter((t) => reactions[t] > 0) : [];
  if (active.length) {
    const gap = chartW / active.length;
    ctx.textAlign = "center";
    active.forEach((t, i) => {
      const cx = chartX + gap * (i + 0.5);
      ctx.fillStyle = "#f4f6ff";
      ctx.font = "500 44px system-ui, sans-serif";
      ctx.fillText(REACTION_META[t].emoji, cx, rowY);
      ctx.font = "800 32px Manrope, sans-serif";
      ctx.fillText(String(reactions![t]), cx, rowY + 40);
    });
    rowY += 82;
  }
  if (moment.mvp) {
    ctx.textAlign = "center";
    ctx.fillStyle = hexA("#e8ecff", 0.75);
    ctx.font = "700 30px Manrope, sans-serif";
    ctx.fillText(`🎤 Loudest fan: ${truncate(moment.mvp, 20)}`, W / 2, rowY);
  }

  // Verification badge.
  const badgeY = 1150;
  const badgeH = 188;
  roundRect(ctx, 90, badgeY, W - 180, badgeH, 28);
  ctx.fillStyle = verified ? hexA("#22d3a6", 0.12) : hexA("#ffffff", 0.05);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = verified ? hexA("#22d3a6", 0.6) : hexA("#ffffff", 0.15);
  ctx.stroke();

  ctx.textAlign = "center";
  if (moment.verification.status === "verified") {
    ctx.fillStyle = "#22d3a6";
    ctx.font = "400 46px Anton, sans-serif";
    ctx.fillText("✓  VERIFIED ON SOLANA", W / 2, badgeY + 70);
    ctx.fillStyle = hexA("#e8ecff", 0.7);
    ctx.font = "600 26px Manrope, sans-serif";
    ctx.fillText("Merkle-proved against the TxLINE daily root", W / 2, badgeY + 112);
    ctx.fillStyle = hexA("#e8ecff", 0.45);
    ctx.font = "500 22px ui-monospace, monospace";
    ctx.fillText(shortKey(moment.verification.pda), W / 2, badgeY + 154);
  } else {
    ctx.fillStyle = hexA("#e8ecff", 0.8);
    ctx.font = "400 42px Anton, sans-serif";
    ctx.fillText("CAPTURED MOMENT", W / 2, badgeY + 78);
    ctx.fillStyle = hexA("#e8ecff", 0.5);
    ctx.font = "600 25px Manrope, sans-serif";
    const reason =
      moment.verification.status === "unverified"
        ? moment.verification.reason
        : "verifying on-chain…";
    wrapText(ctx, reason, W / 2, badgeY + 122, W - 260, 34);
  }
}

// --- helpers ----------------------------------------------------------------

function hexA(hex: string, a: number): string {
  const c = hex.replace("#", "");
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

/** Lift a hex color toward white by `amt` (0..1) — for the poster's top gradient. */
function lighten(hex: string, amt: number): string {
  const c = hex.replace("#", "");
  const mix = (v: number) => Math.round(v + (255 - v) * amt);
  const r = mix(parseInt(c.slice(0, 2), 16));
  const g = mix(parseInt(c.slice(2, 4), 16));
  const b = mix(parseInt(c.slice(4, 6), 16));
  return `rgb(${r},${g},${b})`;
}

/** Filled area chart of the emotional surge (values 0..1, oldest → newest). */
function drawArea(
  ctx: CanvasRenderingContext2D,
  values: number[],
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
): void {
  const max = Math.max(0.001, ...values);
  const stepX = w / (values.length - 1);
  const py = (v: number) => y + h - (v / max) * (h - 8) - 4;

  ctx.beginPath();
  values.forEach((v, i) => {
    const px = x + i * stepX;
    if (i === 0) ctx.moveTo(px, py(v));
    else ctx.lineTo(px, py(v));
  });
  // Close down to the baseline for the fill.
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
  const fill = ctx.createLinearGradient(0, y, 0, y + h);
  fill.addColorStop(0, hexA(color, 0.55));
  fill.addColorStop(1, hexA(color, 0));
  ctx.fillStyle = fill;
  ctx.fill();

  // The line on top.
  ctx.beginPath();
  values.forEach((v, i) => {
    const px = x + i * stepX;
    if (i === 0) ctx.moveTo(px, py(v));
    else ctx.lineTo(px, py(v));
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 5;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
): void {
  const words = text.split(" ");
  let line = "";
  let yy = y;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, yy);
      line = w;
      yy += lineHeight;
    } else {
      line = test;
    }
  }
  ctx.fillText(line, x, yy);
}

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const shortKey = (k: string) => (k.length > 16 ? `${k.slice(0, 8)}…${k.slice(-6)}` : k);
