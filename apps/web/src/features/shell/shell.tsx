import { useEffect, useState, type ReactNode } from 'react';
import { Button, Dialog } from '../../components/ui.js';
import { Icon, type IconName } from '../../components/icon.js';
import { browserShell } from '../../shell/browser-shell.js';
import { CommandPalette } from '../palette/command-palette.js';
import { useCapture } from '../capture/capture-context.js';
import { routeToHash, type Route } from '../../app.js';
import { WorkspaceBrand } from '../../components/workspace-brand.js';
import { LiveClock } from './live-clock.js';

const NAV: Array<{ route: Route; label: string; icon: IconName }> = [
  { route: { name: 'home' }, label: 'Today', icon: 'sun' },
  { route: { name: 'work' }, label: 'Work', icon: 'work' },
  { route: { name: 'goals' }, label: 'Goals', icon: 'goal' },
  { route: { name: 'finance' }, label: 'Money', icon: 'wallet' },
];

export function Shell({ route, navigate, onSignOut, children }: {
  route: Route; navigate: (route: Route) => void; onSignOut: () => Promise<void>; children: ReactNode;
}) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const capture = useCapture();
  useEffect(() => browserShell.registerCommandPalette(() => setPaletteOpen((open) => !open)), []);
  const secondary = route.name === 'metrics' || route.name === 'structure';
  const navigation = <>
    {NAV.map((item) => <a key={item.label} href={routeToHash(item.route)} className="nav-link"
      aria-current={route.name === item.route.name || (route.name === 'goal' && item.route.name === 'goals') ? 'page' : undefined}>
      <Icon name={item.icon} /><span>{item.label}</span>
    </a>)}
    <button className="nav-link" aria-current={secondary ? 'page' : undefined} onClick={() => setMoreOpen(true)}>
      <Icon name="more" /><span>More</span>
    </button>
  </>;
  return <div className="app-shell">
    <a className="skip-link" href="#main-content" onClick={(e) => { e.preventDefault(); document.getElementById('main-content')?.focus(); }}>Skip to content</a>
    <aside className="sidebar">
      <WorkspaceBrand />
      <p className="nav-caption">Your workspace</p>
      <nav aria-label="Main navigation">{navigation}</nav>
      <div className="sidebar-footer">
        <div className="flex items-center gap-3"><span className="avatar">A</span><div><div className="text-fg text-[13px]">Aryesh</div><div className="text-[11px]">Personal workspace</div></div></div>
        <button className="text-action !text-fg-subtle mt-3" onClick={() => void onSignOut()}><Icon name="logout" size={15} /> Sign out</button>
      </div>
    </aside>
    <div className="shell-body">
      {import.meta.env['VITE_REVIEW_MODE'] === 'true' && <div className="review-banner">
        <span>Design review · fictional data · changes reset when stopped</span>
        <a href="/?review=populated#/home">Populated Today</a><a href="/?review=empty#/home">Empty Today</a>
        <a href={'/?review=populated#/goals/' + import.meta.env['VITE_REVIEW_GOAL']}>Goal overview</a>
      </div>}
      <header className="topbar">
        <LiveClock />
        <div className="mobile-brand"><WorkspaceBrand compact /></div>
        <div className="topbar-actions flex items-center gap-3 sm:gap-5">
          <button className="search-trigger" onClick={() => setPaletteOpen(true)} aria-label="Search workspace"><Icon name="search" size={18} /><span>Search anything</span><kbd>⌘ / Ctrl K</kbd></button>
          <Button variant="primary" onClick={() => capture()}><Icon name="plus" size={17} /><span>Quick add</span></Button>
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="workspace-main">{children}</main>
    </div>
    <nav className="mobile-nav" aria-label="Mobile navigation">{navigation}</nav>
    {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} navigate={navigate} />}
    {moreOpen && <Dialog title="Your workspace" onClose={() => setMoreOpen(false)}>
      <p className="page-description mb-4">The details, whenever you need them.</p>
      {([
        ['Tracking', 'Numbers you follow and update', 'metrics', 'chart'],
        ['Life areas & settings', 'Organise your life, export and back up your data', 'structure', 'settings'],
      ] as const).map(([label, hint, name, icon]) => <button key={name} className="choice-row" onClick={() => { navigate({ name }); setMoreOpen(false); }}>
        <Icon name={icon} /><span className="flex-1"><span className="block">{label}</span><span className="row-meta">{hint}</span></span><Icon name="arrow" size={16} />
      </button>)}
      <button className="text-action !text-fg-subtle mt-5" onClick={() => { setMoreOpen(false); void onSignOut(); }}><Icon name="logout" size={16} />Sign out</button>
    </Dialog>}
  </div>;
}
