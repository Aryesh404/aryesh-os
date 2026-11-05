import type { CSSProperties } from 'react';

const paths = {
  sun: 'M12 3v1m0 16v1M3 12h1m16 0h1M5.6 5.6l.7.7m11.4 11.4.7.7M5.6 18.4l.7-.7M17.7 6.3l.7-.7M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  work: 'M8 6V4h8v2M4 7h16v13H4V7Zm0 5h16M10 12v3h4v-3',
  goal: 'M20 12a8 8 0 1 1-8-8m4 0h4v4m0-4-8 8m4 0a4 4 0 1 1-4-4',
  wallet: 'M20 7H5a2 2 0 0 1 0-4h13v4M3 5v14a2 2 0 0 0 2 2h15V7m0 5h-5v5h5m-3-2.5h.01',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  search: 'm21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  plus: 'M12 5v14M5 12h14',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  back: 'M19 12H5m6-6-6 6 6 6',
  check: 'm5 12 4 4L19 6',
  close: 'm6 6 12 12M6 18 18 6',
  leaf: 'M20 4C7 2 2 9 6 16c7 5 15-2 14-12ZM5 20 16 9',
  chart: 'M4 3v17h17M7 14l4-4 4 2 5-7',
  settings: 'M4 7h16M4 17h16M8 4v6m8 4v6',
  grid: 'M3 3h7v7H3Zm11 0h7v7h-7ZM3 14h7v7H3Zm11 0h7v7h-7Z',
  logout: 'M9 4H4v16h5m5-13 5 5-5 5m-5-5h10',
  clock: 'M12 8v5l3 2m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  info: 'M12 11v6m0-10h.01m9 5a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
} as const;
export type IconName = keyof typeof paths;
export function Icon({ name, size = 20, style }: { name: IconName; size?: number; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={name === 'more' ? 4 : 1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>
    <path d={paths[name]} />
  </svg>;
}
