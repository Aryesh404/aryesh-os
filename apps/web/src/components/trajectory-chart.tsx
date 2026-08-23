import { useMemo, useState } from 'react';
import { date as formatDate, pct, statusColor, type Status } from '../lib/format.js';

/**
 * docs/05 §5.1 — the signature visual, and the one to get right before any
 * other. It answers "am I on track?".
 *
 * Layers, in z-order: required-pace reference (dashed) → projection band →
 * actual progress line → snapshot dots on hover → target marker → today rule.
 *
 * Hand-rolled SVG rather than a charting library: this needs two linear scales,
 * a path builder, and tick selection. A chart library's value is in the parts
 * this chart does not use, and it would fight the token system for colour.
 */

export interface SeriesPoint {
  date: number;
  value: number;
}

export interface BandPoint {
  date: number;
  low: number;
  mid: number;
  high: number;
}

export interface TrajectoryChartProps {
  actual: SeriesPoint[];
  band?: BandPoint[] | undefined;
  /** Absent when there is no deadline to be behind (docs/04 §3). */
  targetDate?: number | undefined;
  /** Shown as the dashed reference. Absent for undated goals. */
  requiredFrom?: { date: number; value: number } | undefined;
  now: number;
  status: Status;
  /** Rendered in place of the projection when a gate blocked it. */
  projectionRefusal?: string | undefined;
  /**
   * `momentum` scales to 1.5 and labels the axis in multiples of the expected
   * rate. A momentum goal has no percentage, so showing one would invent the
   * denominator the whole mode exists to avoid (docs/03 §4.0).
   */
  scale?: 'completion' | 'momentum';
  height?: number;
}

const PADDING = { top: 12, right: 56, bottom: 24, left: 36 };

export function TrajectoryChart({
  actual,
  band,
  targetDate,
  requiredFrom,
  now,
  status,
  projectionRefusal,
  scale = 'completion',
  height = 220,
}: TrajectoryChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 720;

  const inner = {
    w: width - PADDING.left - PADDING.right,
    h: height - PADDING.top - PADDING.bottom,
  };

  const domain = useMemo(() => {
    const dates = [
      ...actual.map((p) => p.date),
      ...(band ?? []).map((p) => p.date),
      now,
      ...(targetDate === undefined ? [] : [targetDate]),
    ];
    const min = Math.min(...dates);
    const max = Math.max(...dates);
    return { min, max: max === min ? min + 86_400_000 : max };
  }, [actual, band, now, targetDate]);

  const x = (ms: number): number =>
    PADDING.left + ((ms - domain.min) / (domain.max - domain.min)) * inner.w;
  const yMax = scale === 'momentum' ? 1.5 : 1;
  const ticks = scale === 'momentum' ? [0, 0.5, 1, 1.5] : [0, 0.5, 1];
  const tickLabel = (value: number): string =>
    scale === 'momentum' ? `${value.toFixed(1)}×` : pct(value);

  const y = (value: number): number =>
    PADDING.top + (1 - Math.max(0, Math.min(yMax, value)) / yMax) * inner.h;

  const line = (points: Array<{ date: number; value: number }>): string =>
    points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.date)},${y(p.value)}`).join(' ');

  const bandPath = useMemo(() => {
    if (!band || band.length < 2) return null;
    const top = band.map((p) => `${x(p.date)},${y(p.high)}`);
    const bottom = [...band].reverse().map((p) => `${x(p.date)},${y(p.low)}`);
    return `M${top.join(' L')} L${bottom.join(' L')} Z`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [band, domain]);

  const nearest = useMemo(() => {
    if (hover === null || actual.length === 0) return null;
    return actual.reduce((best, point) =>
      Math.abs(x(point.date) - hover) < Math.abs(x(best.date) - hover) ? point : best,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hover, actual, domain]);

  const colour = statusColor(status);

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        role="img"
        aria-label="Progress over time against target"
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setHover(((e.clientX - rect.left) / rect.width) * width);
        }}
        onMouseLeave={() => setHover(null)}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={PADDING.left}
              x2={width - PADDING.right}
              y1={y(tick)}
              y2={y(tick)}
              stroke="var(--border)"
              strokeWidth={1}
            />
            <text
              x={PADDING.left - 6}
              y={y(tick)}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize={10}
              fill="var(--text-tertiary)"
              className="mono"
            >
              {tickLabel(tick)}
            </text>
          </g>
        ))}

        {/* The pace that would land exactly on target: dashed, never coloured,
            because it is a reference and not an outcome. */}
        {requiredFrom && targetDate !== undefined && scale === 'completion' && (
          <line
            x1={x(requiredFrom.date)}
            y1={y(requiredFrom.value)}
            x2={x(targetDate)}
            y2={y(1)}
            stroke="var(--text-tertiary)"
            strokeWidth={1}
            strokeDasharray="3 4"
          />
        )}

        {bandPath && <path d={bandPath} fill={colour} opacity={0.12} />}

        {actual.length > 1 && (
          <path
            d={line(actual.map((p) => ({ date: p.date, value: p.value })))}
            fill="none"
            stroke={colour}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}

        {actual.length === 1 && actual[0] && (
          <circle cx={x(actual[0].date)} cy={y(actual[0].value)} r={3} fill={colour} />
        )}

        <line
          x1={x(now)}
          x2={x(now)}
          y1={PADDING.top}
          y2={height - PADDING.bottom}
          stroke="var(--border-strong)"
          strokeWidth={1}
        />
        <text
          x={x(now)}
          y={height - PADDING.bottom + 12}
          textAnchor="middle"
          fontSize={9}
          fill="var(--text-tertiary)"
        >
          today
        </text>

        {targetDate !== undefined && (
          <>
            <path
              d={`M${x(targetDate)},${y(1) - 5} l5,5 l-5,5 l-5,-5 Z`}
              fill="var(--text-secondary)"
            />
            <text
              x={x(targetDate)}
              y={height - PADDING.bottom + 12}
              textAnchor="middle"
              fontSize={9}
              fill="var(--text-tertiary)"
            >
              {formatDate(targetDate)}
            </text>
          </>
        )}

        {nearest && (
          <>
            <line
              x1={x(nearest.date)}
              x2={x(nearest.date)}
              y1={PADDING.top}
              y2={height - PADDING.bottom}
              stroke="var(--border-strong)"
              strokeWidth={1}
              strokeDasharray="2 3"
            />
            <circle cx={x(nearest.date)} cy={y(nearest.value)} r={3.5} fill={colour} />
          </>
        )}
      </svg>

      <figcaption className="flex items-baseline justify-between mt-1 text-[11px] text-fg-subtle">
        <span>{actual[0] ? formatDate(actual[0].date) : ''}</span>
        {nearest ? (
          <span className="mono text-fg-muted">
            {formatDate(nearest.date)} · {tickLabel(nearest.value)}
          </span>
        ) : (
          /* docs/05 §5.1 — when a gate blocks the projection, the explanation
             takes its place. An empty chart would say nothing. */
          projectionRefusal && <span className="text-at-risk">◆ {projectionRefusal}</span>
        )}
        <span>{targetDate !== undefined ? formatDate(targetDate) : 'no target date'}</span>
      </figcaption>
    </figure>
  );
}
