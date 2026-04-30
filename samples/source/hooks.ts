/**
 * Sample TypeScript file — exercises Shiki TS highlighting and the
 * brace-based fold-region detector.
 */

import { useEffect, useMemo, useState } from "react";

export type Status = "idle" | "loading" | "ready" | "error";

export interface FetchResult<T> {
  status: Status;
  data: T | null;
  error: Error | null;
}

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(handle);
  }, [value, delayMs]);

  return debounced;
}

/**
 * Fetch JSON from an authenticated endpoint, caching the result by URL.
 * Returns a discriminated result object so consumers can switch on
 * `status` rather than chaining promise handlers.
 */
export async function fetchJson<T>(
  url: string,
  init: RequestInit = {}
): Promise<FetchResult<T>> {
  try {
    const response = await fetch(url, init);
    if (!response.ok) {
      return {
        status: "error",
        data: null,
        error: new Error(`HTTP ${response.status} ${response.statusText}`),
      };
    }
    const data = (await response.json()) as T;
    return { status: "ready", data, error: null };
  } catch (err) {
    return {
      status: "error",
      data: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/** Sum every numeric field of an object (recursive). */
export function deepSum(value: unknown): number {
  if (typeof value === "number") return value;
  if (Array.isArray(value)) return value.reduce<number>((acc, v) => acc + deepSum(v), 0);
  if (value && typeof value === "object") {
    return Object.values(value).reduce<number>((acc, v) => acc + deepSum(v), 0);
  }
  return 0;
}

/** Group by a key derived from each item. */
export function groupBy<T, K extends string | number | symbol>(
  items: readonly T[],
  keyFn: (item: T) => K
): Record<K, T[]> {
  const out = {} as Record<K, T[]>;
  for (const item of items) {
    const k = keyFn(item);
    (out[k] ??= []).push(item);
  }
  return out;
}

// Memoised selector helper.
export function useDerivedSelector<T, R>(
  source: T,
  select: (s: T) => R,
  isEqual: (a: R, b: R) => boolean = Object.is
): R {
  const memoised = useMemo(() => select(source), [source, select]);
  // For a real implementation, you'd wire this into a stable reducer to
  // honour `isEqual`. Here we return the memoised value directly.
  void isEqual;
  return memoised;
}
