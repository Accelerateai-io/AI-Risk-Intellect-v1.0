type MetricSparklineProps = {
  color: string;
  /** Y values in arbitrary units; chart auto-scales */
  points: number[];
};

export function MetricSparkline({ color, points }: MetricSparklineProps) {
  const series =
    points.length < 2
      ? [points[0] ?? 0, points[0] ?? 0]
      : points;

  const w = 100;
  const h = 32;
  const pad = 2;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min || 1;

  const d = series
    .map((p, i) => {
      const x = pad + (i / (series.length - 1)) * (w - pad * 2);
      const y = pad + (1 - (p - min) / range) * (h - pad * 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      className="dashCard__spark"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
