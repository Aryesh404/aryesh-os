import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from './ui.tsx';

/**
 * docs/05 §7 — an error state says what failed and what still works.
 *
 * Scoped rather than global: one panel throwing should not blank the page, and
 * the rest of the dashboard is usually still true.
 */
interface Props {
  children: ReactNode;
  /** What the user loses if this subtree is down. */
  label: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[${this.props.label}]`, error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <section className="border border-behind/40 bg-behind/5 rounded-card p-4">
        <h2 className="text-[13px] font-medium m-0 text-behind">
          ▲ {this.props.label} could not be displayed
        </h2>
        <p className="text-[12px] text-fg-muted mt-1 mb-0">{error.message}</p>
        <p className="text-[11px] text-fg-subtle mt-2 mb-3">
          Everything else on this page is unaffected. Your data is untouched — this
          is a display failure, not a write.
        </p>
        <Button onClick={() => this.setState({ error: null })}>Try again</Button>
      </section>
    );
  }
}
