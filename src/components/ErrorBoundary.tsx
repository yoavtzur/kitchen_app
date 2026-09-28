import { Component, type ErrorInfo, type ReactNode } from 'react';
import { captureBoundaryError } from '../lib/sentry';

export type ErrorFallbackProps = {
  error: unknown;
  /** Sentry's id for this report, or undefined when Sentry is dormant. Shown to the cook so a
   * support conversation can start with a number instead of "it broke". */
  eventId?: string;
  /** Clears the error and re-renders the children. Whether that helps depends entirely on why
   * it crashed, which is why every fallback also offers a reload. */
  reset(): void;
};

type Props = {
  /** Where this boundary sits — 'root', or a route name. Becomes a Sentry tag, and is the
   * difference between "the app crashed" and "the orders screen crashed". */
  boundary: string;
  children: ReactNode;
  fallback(props: ErrorFallbackProps): ReactNode;
  /** When any of these change while an error is showing, the boundary clears itself. The route
   * boundary passes the pathname, so navigating to another tab recovers instead of leaving a
   * dead screen until the app is reloaded. */
  resetKeys?: readonly unknown[];
};

type State = { error: unknown; eventId?: string; keys?: readonly unknown[] };

function keysChanged(a: readonly unknown[] | undefined, b: readonly unknown[] | undefined): boolean {
  if (!a || !b) return a !== b;
  return a.length !== b.length || a.some((value, i) => !Object.is(value, b[i]));
}

/**
 * The only error boundary implementation in the app; `RouteBoundary` and the root boundary in
 * `main.tsx` are both thin wrappers over it.
 *
 * A class component because that is still the only way to implement this in React — there is no
 * hook equivalent of `componentDidCatch`.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    // Compare before storing, so a boundary that has never errored doesn't churn state on
    // every render just because its parent passed a fresh array literal.
    if (state.error && keysChanged(state.keys, props.resetKeys)) {
      return { error: null, eventId: undefined, keys: props.resetKeys };
    }
    if (keysChanged(state.keys, props.resetKeys)) return { keys: props.resetKeys };
    return null;
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    const eventId = captureBoundaryError(error, this.props.boundary, info.componentStack ?? undefined);
    this.setState({ eventId });
  }

  reset = () => {
    this.setState({ error: null, eventId: undefined });
  };

  render() {
    if (this.state.error) {
      return this.props.fallback({ error: this.state.error, eventId: this.state.eventId, reset: this.reset });
    }
    return this.props.children;
  }
}
