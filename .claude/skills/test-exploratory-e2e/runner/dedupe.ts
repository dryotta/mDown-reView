import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface Finding {
  heuristic_id: string;
  screen_id: string;
  anchor: string;
  severity: "P1" | "P2" | "P3";
  detail: string;
  screenshot: string;
  /**
   * Optional grouping tag set by the agent. Findings sharing the same
   * `group` are filed under a single GitHub issue by `file_issues`.
   * Examples: "responsive-layout", "modal-ux", "visual-polish".
   */
  group?: string;
}

export interface StoredFinding {
  issue: number | null;
  first_seen: string;
  last_seen: string;
  reproductions: number;
  heuristic_id: string;
  screen_id: string;
}

export interface Store {
  version: 1;
  findings: Record<string, StoredFinding>;
}

export function normaliseAnchor(a: string): string {
  return a
    .replace(/\[([a-z-]+)=[a-z0-9_-]+\]/gi, "[$1]")
    .replace(/:nth-child\(\d+\)/g, ":nth-child")
    .replace(/:nth-of-type\(\d+\)/g, ":nth-of-type");
}

export function computeDedupeKey(
  heuristicId: string,
  screenId: string,
  anchor: string,
): string {
  return createHash("sha256")
    .update(`${heuristicId}|${screenId}|${normaliseAnchor(anchor)}`)
    .digest("hex");
}

export function loadStore(path: string): Store {
  if (!existsSync(path)) return { version: 1, findings: {} };
  return JSON.parse(readFileSync(path, "utf8")) as Store;
}

export function saveStore(path: string, store: Store): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(store, null, 2));
}

export interface MergeResult {
  key: string;
  status: "NEW" | "REPRODUCED";
}

export function mergeFinding(
  store: Store,
  f: Finding,
  nowIso: string,
): MergeResult {
  const key = computeDedupeKey(f.heuristic_id, f.screen_id, f.anchor);
  const existing = store.findings[key];
  if (!existing) {
    store.findings[key] = {
      issue: null,
      first_seen: nowIso,
      last_seen: nowIso,
      reproductions: 1,
      heuristic_id: f.heuristic_id,
      screen_id: f.screen_id,
    };
    return { key, status: "NEW" };
  }
  existing.last_seen = nowIso;
  existing.reproductions += 1;
  return { key, status: "REPRODUCED" };
}
