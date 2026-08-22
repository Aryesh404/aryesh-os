import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { trpc } from './lib/trpc.js';
import { browserShell } from './shell/browser-shell.js';

/**
 * M1 smoke screen. Its only job is to prove the spine is connected end to end:
 * a value enters the API, the pure intelligence core normalises it, and the
 * derivation comes back explainable (docs/01 §5). Real surfaces arrive in M6/M7.
 */
export function App(): React.JSX.Element {
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => browserShell.registerCommandPalette(() => setPaletteOpen((v) => !v)), []);

  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => trpc.health.ping.query(),
  });

  // The ₹5L MRR case from docs/14 Case 1, computed by the real engine.
  const mrr = useQuery({
    queryKey: ['normalise', 'mrr'],
    queryFn: () =>
      trpc.measure.normalise.query({
        direction: 'increase',
        current: 140_000,
        baseline: 0,
        target: 500_000,
        label: 'monthly_revenue',
      }),
  });

  return (
    <main
      style={{
        maxWidth: 720,
        margin: '0 auto',
        padding: 'var(--s-12) var(--s-6)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--s-8)',
      }}
    >
      <header>
        <h1 style={{ fontSize: 'var(--fs-28)', margin: 0, fontWeight: 600 }}>Aryesh OS</h1>
        <p style={{ color: 'var(--text-tertiary)', margin: 'var(--s-2) 0 0' }}>
          Phase 1 · M1 skeleton · observe → measure → understand → visualize
        </p>
      </header>

      <Card title="API">
        {health.isPending && <Muted>connecting…</Muted>}
        {health.isError && <Status tone="behind">unreachable — is the API running?</Status>}
        {health.data && (
          <Status tone="on-track">
            healthy · v{health.data.version} ·{' '}
            <span className="mono">{new Date(health.data.at).toLocaleTimeString()}</span>
          </Status>
        )}
      </Card>

      <Card title="Intelligence core">
        {mrr.isPending && <Muted>computing…</Muted>}
        {mrr.isError && <Status tone="behind">{String(mrr.error.message)}</Status>}
        {mrr.data && (
          <>
            <div
              className="mono"
              style={{ fontSize: 'var(--fs-40)', lineHeight: 1, color: 'var(--st-at-risk)' }}
            >
              {(mrr.data.value * 100).toFixed(0)}%
            </div>
            <Muted>₹5L MRR by March 2027 — computed, not stored</Muted>
            <dl
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr',
                gap: 'var(--s-1) var(--s-4)',
                margin: 'var(--s-4) 0 0',
                fontSize: 'var(--fs-12)',
              }}
            >
              <dt style={{ color: 'var(--text-tertiary)' }}>method</dt>
              <dd className="mono" style={{ margin: 0 }}>
                {mrr.data.method}
              </dd>
              <dt style={{ color: 'var(--text-tertiary)' }}>confidence</dt>
              <dd className="mono" style={{ margin: 0 }}>
                {mrr.data.confidence.toFixed(2)}
              </dd>
              {mrr.data.inputs.map((input) => (
                <Fragment key={input.label}>
                  <dt style={{ color: 'var(--text-tertiary)' }}>{input.label}</dt>
                  <dd className="mono" style={{ margin: 0 }}>
                    {input.detail}
                  </dd>
                </Fragment>
              ))}
            </dl>
          </>
        )}
      </Card>

      <Card title="Shell">
        <Muted>
          {browserShell.kind} · global hotkey{' '}
          {browserShell.supportsGlobalHotkey ? 'available' : 'in-document only (Tauri: Phase 2)'}
        </Muted>
        <div style={{ marginTop: 'var(--s-3)' }}>
          <kbd
            style={{
              padding: '2px 6px',
              border: '1px solid var(--border-strong)',
              borderRadius: 'var(--r-control)',
              fontSize: 'var(--fs-11)',
            }}
          >
            Ctrl/Cmd + K
          </kbd>{' '}
          <span style={{ color: paletteOpen ? 'var(--accent)' : 'var(--text-tertiary)' }}>
            {paletteOpen ? 'captured' : 'idle'}
          </span>
        </div>
      </Card>
    </main>
  );
}

function Fragment({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <>{children}</>;
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-card)',
        padding: 'var(--s-4)',
      }}
    >
      <h2
        style={{
          fontSize: 'var(--fs-11)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: 'var(--text-tertiary)',
          margin: '0 0 var(--s-3)',
          fontWeight: 500,
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function Muted({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p style={{ color: 'var(--text-secondary)', margin: 0 }}>{children}</p>;
}

function Status({
  tone,
  children,
}: {
  tone: 'on-track' | 'at-risk' | 'behind';
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <p style={{ color: `var(--st-${tone})`, margin: 0 }}>
      {tone === 'on-track' ? '● ' : '▲ '}
      {children}
    </p>
  );
}
