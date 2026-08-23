import { ConfidenceMeter, ContributionBar, ProgressRing, StatusChip } from '../../components/metric.tsx';
import { Empty, Muted, Subtle } from '../../components/ui.tsx';
import { pct } from '../../lib/format.js';

/**
 * docs/01 §5 — explainability is a return type, not a log. This renders the
 * `Explained<T>` the engine returns, unchanged: click a number, see exactly
 * what made it.
 */

type ExplainedInput = {
  ref: { kind: string; id: string };
  label: string;
  value: number;
  weight?: number | undefined;
  detail?: string | undefined;
};

type Explained = {
  value: number;
  method: string;
  inputs: ExplainedInput[];
  confidence: number;
  caveats: string[];
};

export type Outcome =
  | { measurable: true; mode: 'completion'; progress: Explained; degraded: { reason: string } | null }
  | {
      measurable: true;
      mode: 'momentum';
      momentum: Explained;
      levels: Array<{ refId: string; label: string; value: number; detail: string; confidence: number }>;
      degraded: { reason: string } | null;
    }
  | { measurable: false; mode: string; reason: string };

export function ExplainPanel({ outcome }: { outcome: Outcome }) {
  if (!outcome.measurable) {
    return (
      <Empty
        title="This cannot be measured yet"
        hint={outcome.reason}
      />
    );
  }

  const explained = outcome.mode === 'completion' ? outcome.progress : outcome.momentum;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        {outcome.mode === 'completion' ? (
          <ProgressRing
            value={explained.value}
            confidence={explained.confidence}
            status="unknown"
            size={72}
          />
        ) : (
          <div>
            {/* A momentum goal has no percentage. Showing one would invent a
                denominator that does not exist (docs/03 §4.0). */}
            <div className="mono text-[28px] leading-none">
              {explained.value.toFixed(2)}×
            </div>
            <Subtle>of expected rate</Subtle>
          </div>
        )}

        <div className="space-y-1">
          <div className="text-[12px] text-fg-subtle">
            method <span className="mono text-fg-muted">{explained.method}</span>
          </div>
          <ConfidenceMeter value={explained.confidence} />
          {outcome.mode === 'momentum' && (
            <StatusChip status={explained.value >= 1 ? 'advancing' : 'slowing'} />
          )}
        </div>
      </div>

      {explained.inputs.length > 0 && (
        <div className="space-y-2">
          <ContributionBar inputs={explained.inputs} />
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-fg-subtle text-left">
                <th className="font-normal pb-1">contributor</th>
                <th className="font-normal pb-1 w-20 text-right">weight</th>
                <th className="font-normal pb-1 w-20 text-right">value</th>
                <th className="font-normal pb-1 pl-4">detail</th>
              </tr>
            </thead>
            <tbody>
              {explained.inputs.map((input) => (
                <tr key={`${input.ref.kind}:${input.ref.id}`} className="border-t border-line">
                  <td className="py-1.5">
                    <span className="text-fg-subtle mr-1.5">{input.ref.kind}</span>
                    {input.label}
                  </td>
                  <td className="py-1.5 text-right mono">
                    {input.weight === undefined ? '—' : pct(input.weight)}
                  </td>
                  <td className="py-1.5 text-right mono">{pct(input.value)}</td>
                  <td className="py-1.5 pl-4 text-fg-subtle">{input.detail ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {outcome.mode === 'momentum' && outcome.levels.length > 0 && (
        <div>
          <h3 className="text-[11px] uppercase tracking-[0.08em] text-fg-subtle mb-2">
            Level indicators
          </h3>
          {/* Shown separately, never averaged into the momentum score: blending
              a self-rating with a shipping rate produces a number that means
              nothing (docs/14 Case 3). */}
          <ul className="space-y-1 text-[12px] list-none p-0 m-0">
            {outcome.levels.map((level) => (
              <li key={level.refId} className="flex justify-between border-t border-line py-1.5">
                <span>{level.label}</span>
                <span className="mono text-fg-muted">{level.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {outcome.degraded && (
        <div className="border-l-2 border-at-risk pl-3 py-1">
          <Subtle>degraded</Subtle>
          <Muted>{outcome.degraded.reason}</Muted>
        </div>
      )}

      {explained.caveats.length > 0 && (
        <ul className="list-none p-0 m-0 space-y-1">
          {explained.caveats.map((caveat) => (
            <li key={caveat} className="text-[12px] text-at-risk">
              ◆ {caveat}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
