import { Component, Fragment, type ComponentType, type ReactNode } from 'react';
import { safeCall } from '../core/safe';
import type { MeheryError } from '../types';
import { useMehery } from '../react/context';

interface GuardProps {
  /** What to show instead. A function gets a `retry` that remounts the children. */
  fallback: ReactNode | ((retry: () => void) => ReactNode);
  /** Where the failure happened, for the onError message. */
  where: string;
  onError?: (error: MeheryError) => void;
  children: ReactNode;
}

/**
 * Error boundary for SDK UI only (never around the host app's own tree). A render crash becomes a
 * fallback plus an onError report, so one bad message or custom component can't take the app down.
 */
export class Guard extends Component<GuardProps, { failed: boolean; attempt: number }> {
  state = { failed: false, attempt: 0 };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(cause: unknown) {
    safeCall(this.props.onError, { code: 'RENDER', message: `${this.props.where} failed to render and was replaced`, cause });
  }

  retry = () => this.setState((s) => ({ failed: false, attempt: s.attempt + 1 }));

  render() {
    const { fallback, children } = this.props;
    if (this.state.failed) return typeof fallback === 'function' ? fallback(this.retry) : fallback;
    return <Fragment key={this.state.attempt}>{children}</Fragment>;
  }
}

/** Guard wired to the provider's onError. */
export function ContainedRender({ where, fallback, children }: Omit<GuardProps, 'onError'>) {
  const { client } = useMehery();
  return (
    <Guard where={where} fallback={fallback} onError={(e) => client.report(e)}>
      {children}
    </Guard>
  );
}

/**
 * Renders the host's custom component if given, falling back to the built-in one if it crashes.
 * The built-in one is itself guarded (fallback: nothing).
 */
export function Slot<P extends object>({ name, custom, builtIn, props }: { name: string; custom: ComponentType<P> | undefined; builtIn: ComponentType<P>; props: P }) {
  const BuiltIn = builtIn;
  const safeBuiltIn = (
    <ContainedRender where={name} fallback={null}>
      <BuiltIn {...props} />
    </ContainedRender>
  );
  if (!custom) return safeBuiltIn;
  const Custom = custom;
  return (
    <ContainedRender where={`Custom ${name}`} fallback={safeBuiltIn}>
      <Custom {...props} />
    </ContainedRender>
  );
}
