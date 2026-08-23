/** Formatting lives at the edge; storage is always UTC ms and minor units. */

export const pct = (value: number, digits = 0): string =>
  `${(value * 100).toFixed(digits)}%`;

const inr = (amount: number, currency: string): string =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);

/**
 * Transactions and account balances are integer **minor units** (docs/11), so
 * they divide by 100 on the way out.
 */
export const money = (minor: number, currency = 'INR'): string =>
  inr(minor / 100, currency);

/**
 * Metric values are plain numbers, not minor units — a `currency` metric
 * reading of 500000 means ₹5,00,000. Formatting one through `money()` would
 * under-report it by a factor of 100.
 */
export const currencyAmount = (amount: number, currency = 'INR'): string =>
  inr(amount, currency);

export function compactNumber(value: number): string {
  if (Math.abs(value) >= 10_000_000) return `${(value / 10_000_000).toFixed(2)}Cr`;
  if (Math.abs(value) >= 100_000) return `${(value / 100_000).toFixed(2)}L`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(Math.round(value * 100) / 100);
}

export function metricValue(value: number, unit: string): string {
  switch (unit) {
    case 'currency':
      return currencyAmount(value);
    case 'percent':
      return `${Math.round(value * 10) / 10}%`;
    case 'duration':
      return `${Math.round(value * 10) / 10}d`;
    default:
      return compactNumber(value);
  }
}

export const date = (ms: number): string =>
  new Date(ms).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

export const dateInput = (ms: number): string =>
  new Date(ms).toISOString().slice(0, 10);

export const fromDateInput = (value: string): number => Date.parse(`${value}T00:00:00Z`);

export function relativeDays(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}

/** docs/04 §3 — two vocabularies over one palette. */
export type Status =
  | 'ahead'
  | 'on_track'
  | 'at_risk'
  | 'behind'
  | 'stalled'
  | 'unknown'
  | 'advancing'
  | 'steady'
  | 'slowing';

export const statusColor = (status: Status): string => {
  switch (status) {
    case 'ahead':
    case 'advancing':
      return 'var(--st-ahead)';
    case 'on_track':
    case 'steady':
      return 'var(--st-on-track)';
    case 'at_risk':
    case 'slowing':
      return 'var(--st-at-risk)';
    case 'behind':
      return 'var(--st-behind)';
    case 'stalled':
      return 'var(--st-stalled)';
    default:
      return 'var(--st-unknown)';
  }
};

/** Status is never conveyed by colour alone (docs/05 §8). */
export const statusGlyph = (status: Status): string => {
  switch (status) {
    case 'ahead':
    case 'advancing':
      return '▲';
    case 'on_track':
    case 'steady':
      return '●';
    case 'at_risk':
    case 'slowing':
      return '◆';
    case 'behind':
      return '▼';
    case 'stalled':
      return '■';
    default:
      return '○';
  }
};

export const statusLabel = (status: Status): string =>
  status.replace('_', ' ');
