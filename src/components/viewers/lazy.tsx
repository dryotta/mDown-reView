import { Suspense, lazy } from "react";
import type { ComponentType, LazyExoticComponent, ReactNode } from "react";

/**
 * Wraps a dynamically-imported component in a Suspense boundary with a small
 * inline "Loading…" fallback, so callers can drop a heavy viewer (Mermaid,
 * KaTeX, …) inline without re-implementing the boilerplate every time.
 */
export function lazyWithSuspense<P>(
  loader: () => Promise<{ default: ComponentType<P> }>,
  fallback: ReactNode = (
    <span style={{ fontSize: 12, color: "var(--color-text-secondary, #6e7781)" }}>
      Loading…
    </span>
  ),
): ComponentType<P> {
  const Lazy: LazyExoticComponent<ComponentType<P>> = lazy(loader);
  return function Lazied(props: P) {
    return (
      <Suspense fallback={fallback}>
        {/* @ts-expect-error — generic prop forwarding */}
        <Lazy {...props} />
      </Suspense>
    );
  };
}
