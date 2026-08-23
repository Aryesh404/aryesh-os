import { forwardRef, type ReactNode } from 'react';

/**
 * The small set of primitives the whole app is built from. Deliberately plain:
 * hairlines and surface lightness carry structure, not shadows (docs/05 §3).
 */

const cx = (...parts: Array<string | false | undefined>): string =>
  parts.filter(Boolean).join(' ');

export function Card({
  title,
  action,
  children,
  className,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cx(
        'bg-surface border border-line rounded-card',
        className ?? 'p-4',
      )}
    >
      {(title || action) && (
        <header className="flex items-baseline justify-between mb-3">
          {title && (
            <h2 className="text-[11px] uppercase tracking-[0.08em] text-fg-subtle font-medium">
              {title}
            </h2>
          )}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

type ButtonVariant = 'primary' | 'ghost' | 'danger';

export const Button = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }
>(function Button({ variant = 'ghost', className, ...props }, ref) {
  const base =
    'inline-flex items-center gap-2 rounded-control px-3 py-1.5 text-[13px] font-medium ' +
    'transition-colors duration-[120ms] disabled:opacity-40 disabled:pointer-events-none';
  const styles: Record<ButtonVariant, string> = {
    primary: 'bg-accent text-white hover:bg-accent-dim',
    ghost: 'border border-line text-fg hover:border-line-strong hover:bg-raised',
    danger: 'border border-line text-behind hover:border-behind/50 hover:bg-raised',
  };
  return <button ref={ref} className={cx(base, styles[variant], className)} {...props} />;
});

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | undefined;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-[12px] text-fg-muted mb-1.5">{label}</span>
      {children}
      {error ? (
        <span className="block text-[11px] text-behind mt-1">{error}</span>
      ) : hint ? (
        <span className="block text-[11px] text-fg-subtle mt-1">{hint}</span>
      ) : null}
    </label>
  );
}

export const Input = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cx('field-input', className)} {...props} />;
});

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea ref={ref} rows={3} className={cx('field-input resize-y', className)} {...props} />
  );
});

export const Select = forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, children, ...props }, ref) {
  return (
    <select ref={ref} className={cx('field-input', className)} {...props}>
      {children}
    </select>
  );
});

export function Muted({ children }: { children: ReactNode }) {
  return <p className="text-fg-muted m-0">{children}</p>;
}

export function Subtle({ children }: { children: ReactNode }) {
  return <span className="text-fg-subtle text-[12px]">{children}</span>;
}

/**
 * Empty states carry the honest message, not a shrug (docs/05 §7). If something
 * cannot be shown, the reason is the content.
 */
export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="border border-dashed border-line rounded-card p-6 text-center">
      <p className="text-fg-muted m-0">{title}</p>
      {hint && <p className="text-fg-subtle text-[12px] mt-1 mb-0">{hint}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/** Skeletons are shaped like the content; spinners tell you nothing. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('bg-raised rounded animate-pulse', className ?? 'h-4 w-24')} />;
}

/**
 * docs/05 §7 — a stale surface renders dimmed with the time it was last true,
 * rather than pretending to be current. Never treat old data as fresh.
 */
export function Stale({
  since,
  children,
}: {
  since: number | null;
  children: ReactNode;
}) {
  if (since === null) return <>{children}</>;
  const minutes = Math.floor((Date.now() - since) / 60_000);
  if (minutes < 2) return <>{children}</>;

  return (
    <div className="relative">
      <div className="opacity-70">{children}</div>
      <span className="absolute top-0 right-0 text-[10px] text-fg-subtle">
        as of {new Date(since).toLocaleTimeString()}
      </span>
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <p className="text-behind text-[13px] m-0" role="alert">
      ▲ {message}
    </p>
  );
}

export function Dialog({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[8vh] overflow-y-auto"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-label={title}
        className={cx(
          'bg-raised border border-line-strong rounded-panel w-full',
          wide ? 'max-w-3xl' : 'max-w-lg',
        )}
      >
        <header className="flex items-center justify-between px-4 py-3 border-b border-line">
          <h2 className="text-[13px] font-medium m-0">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-fg-subtle hover:text-fg text-[16px] leading-none"
          >
            ×
          </button>
        </header>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
