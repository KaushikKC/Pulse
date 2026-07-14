interface Props {
  /** 0..1 values, oldest → newest. */
  values: number[];
  color: string;
  width?: number;
  height?: number;
}

/**
 * A tiny filled area sparkline for a moment's emotional surge — pure inline SVG,
 * no deps. Draws the shape of how the crowd's intensity spiked around the event.
 */
export function Sparkline({ values, color, width = 300, height = 64 }: Props) {
  if (values.length < 2) return null;

  const max = Math.max(0.001, ...values);
  const stepX = width / (values.length - 1);
  const y = (v: number) => height - (v / max) * (height - 6) - 3;
  const pts = values.map((v, i) => [i * stepX, y(v)] as const);

  const line = pts.map(([x, yy], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${yy.toFixed(1)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  const gid = `spark-${color.replace("#", "")}`;

  return (
    <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.5" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
