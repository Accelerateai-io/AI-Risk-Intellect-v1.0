import { useMemo, type CSSProperties } from "react";

type DayLineChartProps = {
  title: string;
  subtitle: string;
  color: string;
  labels: string[];
  values: number[];
  valueFormatter?: (n: number) => string;
  loading?: boolean;
};

export function DayLineChart({
  title,
  subtitle,
  color,
  labels,
  values,
  valueFormatter = (n) => String(n),
  loading = false,
}: DayLineChartProps) {
  const w = 100;
  const h = 48;
  const padX = 2;
  const padY = 6;

  const { points, d, areaD, peak, total } = useMemo(() => {
    const max = Math.max(...values, 1);
    const min = 0;
    const range = max - min || 1;

    const pts = values.map((p, i) => {
      const x =
        values.length <= 1
          ? w / 2
          : padX + (i / (values.length - 1)) * (w - padX * 2);
      const y = padY + (1 - (p - min) / range) * (h - padY * 2);
      return { x, y, p };
    });

    const line = pts
      .map((pt, i) => `${i === 0 ? "M" : "L"}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`)
      .join(" ");

    const baseline = h - padY;
    const area =
      pts.length > 0
        ? `${line} L${pts[pts.length - 1]!.x.toFixed(1)},${baseline} L${pts[0]!.x.toFixed(1)},${baseline} Z`
        : "";

    return {
      points: pts,
      d: line,
      areaD: area,
      peak: Math.max(...values, 0),
      total: values.reduce((a, b) => a + b, 0),
    };
  }, [values]);

  const gridLines = [0.25, 0.5, 0.75].map((pct) => padY + (1 - pct) * (h - padY * 2));

  return (
    <article
      className={`obsChart obsChart--${loading ? "loading" : "ready"}`}
      aria-label={title}
      style={{ "--obs-chart-color": color } as CSSProperties}
    >
      <header className="obsChart__head">
        <div className="obsChart__headText">
          <h3 className="obsChart__title">{title}</h3>
          <p className="obsChart__subtitle">{subtitle}</p>
        </div>
        <div className="obsChart__stats">
          <span className="obsChart__stat">
            <span className="obsChart__statLabel">Day total</span>
            <span className="obsChart__statValue">
              {loading ? "—" : valueFormatter(total)}
            </span>
          </span>
          <span className="obsChart__stat">
            <span className="obsChart__statLabel">Peak hour</span>
            <span className="obsChart__statValue">
              {loading ? "—" : valueFormatter(peak)}
            </span>
          </span>
        </div>
      </header>

      <div className="obsChart__plot" aria-hidden={loading}>
        {loading ? (
          <div className="obsChart__skeleton" />
        ) : (
          <svg
            className="obsChart__svg"
            viewBox={`0 0 ${w} ${h}`}
            preserveAspectRatio="none"
          >
            {gridLines.map((y, i) => (
              <line
                key={i}
                x1={padX}
                y1={y}
                x2={w - padX}
                y2={y}
                className="obsChart__grid"
              />
            ))}
            {areaD ? <path d={areaD} className="obsChart__area" /> : null}
            <path d={d} className="obsChart__line" />
            {points.map((pt, i) =>
              pt.p > 0 ? (
                <circle
                  key={labels[i] ?? i}
                  cx={pt.x}
                  cy={pt.y}
                  r="1.35"
                  className="obsChart__dot"
                />
              ) : null,
            )}
          </svg>
        )}
      </div>

      <div className="obsChart__axis" aria-hidden>
        <span>{labels[0] ?? "12AM"}</span>
        <span>{labels[6] ?? labels[Math.floor(labels.length / 4)] ?? ""}</span>
        <span>{labels[12] ?? ""}</span>
        <span>{labels[18] ?? ""}</span>
        <span>{labels[labels.length - 1] ?? "11PM"}</span>
      </div>
    </article>
  );
}
