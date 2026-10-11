import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '../../components/ui.tsx';
import { browserShell } from '../../shell/browser-shell.js';
import { CommandPalette } from '../palette/command-palette.tsx';
import type { Route } from '../../app.js';

const NAV: Array<{ route: Route; label: string }> = [
  { route: { name: 'home' }, label: 'Today' },
  { route: { name: 'goals' }, label: 'Goals' },
  { route: { name: 'metrics' }, label: 'Metrics' },
  { route: { name: 'finance' }, label: 'Finance' },
  { route: { name: 'work' }, label: 'Work' },
  { route: { name: 'structure' }, label: 'Structure' },
];

export function Shell({
  route,
  navigate,
  onSignOut,
  children,
}: {
  route: Route;
  navigate: (route: Route) => void;
  onSignOut: () => Promise<void>;
  children: ReactNode;
}) {
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(
    () => browserShell.registerCommandPalette(() => setPaletteOpen((open) => !open)),
    [],
  );

  return (
    <div className="min-h-full flex flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <header className="border-b border-line sticky top-0 bg-canvas/95 backdrop-blur z-10">
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-2 md:py-0 min-h-12 flex flex-wrap md:flex-nowrap items-center justify-between gap-2 md:gap-6">
          <span className="font-semibold text-[14px] tracking-tight">Aryesh OS</span>

          <nav className="flex items-center gap-1 overflow-x-auto max-w-full order-3 md:order-2 w-full md:w-auto py-1 md:py-0 scrollbar-none">
            {NAV.map((item) => {
              const active =
                route.name === item.route.name ||
                (route.name === 'goal' && item.route.name === 'goals');
              return (
                <button
                  key={item.label}
                  onClick={() => navigate(item.route)}
                  aria-current={active ? 'page' : undefined}
                  className={`px-2.5 py-1 rounded-control text-[13px] whitespace-nowrap transition-colors duration-[120ms] ${
                    active ? 'text-fg bg-raised' : 'text-fg-subtle hover:text-fg-muted'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className="flex items-center gap-3 order-2 md:order-3">
            <button
              onClick={() => setPaletteOpen(true)}
              className="text-fg-subtle hover:text-fg-muted text-[12px] flex items-center gap-1.5"
            >
              Search
              <kbd className="hidden sm:inline-block border border-line-strong rounded px-1.5 py-0.5 text-[10px]">
                {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'} K
              </kbd>
            </button>

            <Button onClick={() => void onSignOut()} className="text-[12px] px-2 py-1">
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 md:px-6 py-6 md:py-8">{children}</main>

      {paletteOpen && (
        <CommandPalette onClose={() => setPaletteOpen(false)} navigate={navigate} />
      )}
    </div>
  );
}
