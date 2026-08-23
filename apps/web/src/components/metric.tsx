import { useEffect, useRef, useState } from 'react';
import { pct, statusColor, statusGlyph, statusLabel, type Status } from '../lib/format.js';

/**
 * The one component that owns numbers (docs/11 conventions): tabular figures,
 * and animation *from the previous value* rather than from zero, because the
 * point is to show the delta (docs/05 §4).
 */

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function useCountUp(value: number, durationMs = 400): number {
  const [shown, setShown] = useState(value);
  const previous = useRef(value);

  useEffect(() => {
    const from = previous.current;
    previous.current = value;

    if (from === value) return;
    if (prefersReducedMotion()) {
      setShown(value);
      return;
    }

    let frame = 0;
    const start = performance.now();
    const step = (now: number): void => {
      const t = Math.min(1, (now - start) / durationMs);
      // easeOutExpo
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      setShown(from + (value - from) * eased);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, durationMs]);

  return shown;
}

export function Num({
  value,
  format,
  className,
  animate = true,
}: {
  value: number;
  format?: (n: number) => string;
  className?: string;
  animate?: boolean;
}) {
  const shown = useCountUp(animate ? value : value);
  const display = animate ? shown : value;
  return (
    <span className={`mono ${className ?? ''}`}>
      {format ? format(display) : Math.round(display * 100) / 100}
    </span>
  );
}

export function StatusChip({ status }: { status: Status }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[12px]"
      style={{ color: statusColor(status) }}
    >
      <span aria-hidden>{statusGlyph(status)}</span>
      {statusLabel(status)}
    </span>
  );
}

/**
 * docs/05 §5.2 — confidence is encoded structurally, not chromatically. Below
 * 0.5 the ring is a dashed outline with an unfilled interior, so colour stays
 * free to mean status.
 */
export function ProgressRing({
  value,
  confidence = 1,
  size = 64,
  status = 'unknown',
  areaColor,
}: {
  value: number | null;
  confidence?: number;
  size?: number;
  status?: Status;
  areaColor?: string | undefined;
}) {
  const stroke = 3;
  const radius = (size - stroke * 2 - (areaColor ? 4 : 0)) / 2;
  const circumference = 2 * Math.PI * radius;
  const lowConfidence = confidence < 0.5;
  const filled = value === null ? 0 : Math.max(0, Math.min(1, value));
  const animated = useCountUp(filled, 600);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img">
      {areaColor && (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius + 4}
          fill="none"
          stroke={areaColor}
          strokeWidth={1}
          opacity={0.5}
        />
      )}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--border)"
        strokeWidth={stroke}
      />
      {value !== null && (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={statusColor(status)}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={
            lowConfidence
              ? '3 4'
              : `${circumference * animated} ${circumference * (1 - animated)}`
          }
          strokeDashoffset={0}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          opacity={lowConfidence ? 0.6 : 1}
        />
      )}
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        className="mono"
        fontSize={size / 4.5}
        fill="var(--text-primary)"
      >
        {value === null ? '—' : pct(animated)}
      </text>
    </svg>
  );
}

/**
 * A wide, mostly-empty segment reads instantly as "this matters a lot and is
 * not moving" (docs/05 §5.3).
 */
export function ContributionBar({
  inputs,
}: {
  inputs: Array<{ label: string; value: number; weight?: number | undefined }>;
}) {
  const total = inputs.reduce((sum, i) => sum + (i.weight ?? 0), 0) || 1;

  return (
    <div className="flex h-6 w-full overflow-hidden rounded-control border border-line">
      {inputs.map((input) => {
        const share = (input.weight ?? 0) / total;
        return (
          <div
            key={input.label}
            className="relative border-r border-line last:border-r-0 bg-inset"
            style={{ width: `${share * 100}%` }}
            title={`${input.label} — weight ${(share * 100).toFixed(0)}%, at ${pct(input.value)}`}
          >
            <div
              className="absolute inset-y-0 left-0 transition-[width] duration-[600ms]"
              style={{
                width: `${Math.min(1, Math.max(0, input.value)) * 100}%`,
                background: 'var(--accent)',
                opacity: 0.55,
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

export function ConfidenceMeter({ value }: { value: number }) {
  const low = value < 0.5;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="inline-block h-1 w-16 rounded bg-inset overflow-hidden">
        <span
          className="block h-full"
          style={{
            width: `${value * 100}%`,
            background: low ? 'var(--st-at-risk)' : 'var(--st-on-track)',
          }}
        />
      </span>
      <span className="mono text-[11px] text-fg-subtle">{value.toFixed(2)}</span>
      {low && <span className="text-[11px] text-at-risk">low confidence</span>}
    </span>
  );
}
