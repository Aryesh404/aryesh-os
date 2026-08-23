import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '../../components/ui.tsx';
import { browserShell } from '../../shell/browser-shell.js';
import { CommandPalette } from '../palette/command-palette.tsx';
import type { Route } from '../../app.js';

const NAV: Array<{ route: Route; label: string }> = [
  { route: { name: 'home' }, label: 'Today' },
  { route: { name: 'goals' }, label: 'Goals' },
  { route: { name: 'metrics' }, label: 'Metrics' },
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
    <div className="min-h-full flex flex-col">
      <header className="border-b border-line sticky top-0 bg-canvas/95 backdrop-blur z-10">
        <div className="max-w-6xl mx-auto px-6 h-12 flex items-center gap-6">
          <span className="font-semibold text-[14px] tracking-tight">Aryesh OS</span>

          <nav className="flex items-center gap-1 flex-1">
            {NAV.map((item) => {
              const active =
                route.name === item.route.name ||
                (route.name === 'goal' && item.route.name === 'goals');
              return (
                <button
                  key={item.label}
                  onClick={() => navigate(item.route)}
                  aria-current={active ? 'page' : undefined}
                  className={`px-2.5 py-1 rounded-control text-[13px] transition-colors duration-[120ms] ${
                    active ? 'text-fg bg-raised' : 'text-fg-subtle hover:text-fg-muted'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          <button
            onClick={() => setPaletteOpen(true)}
            className="text-fg-subtle hover:text-fg-muted text-[12px] flex items-center gap-2"
          >
            Search
            <kbd className="border border-line-strong rounded px-1.5 py-0.5 text-[10px]">
              {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'} K
            </kbd>
          </button>

          <Button onClick={() => void onSignOut()} className="text-[12px] px-2 py-1">
            Sign out
          </Button>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-8">{children}</main>

      {paletteOpen && (
        <CommandPalette onClose={() => setPaletteOpen(false)} navigate={navigate} />
      )}
    </div>
  );
}
