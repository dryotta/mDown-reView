import { stripVerbatimPrefix } from "@/lib/paths";
import type { RecentItem, Tab } from "@/store";

/**
 * Shape of the persisted UI snapshot v1 needs to mutate. Limited to the
 * fields the migration touches; the rest pass through untouched. Using a
 * named type avoids the `as unknown as ReturnType<NonNullable<…>>` double
 * cast and gives reviewers a single place to see what v1 rewrites.
 */
interface PersistedUI {
  root?: string;
  activeTabPath?: string;
  tabs?: Tab[];
  recentItems?: RecentItem[];
  expandedFolders?: Record<string, boolean>;
  [key: string]: unknown;
}

/**
 * v1 migration (issue #89): strip Windows `\\?\` verbatim prefixes from
 * every persisted path field so snapshots written by pre-#89 clients
 * agree on string identity with the post-fix Rust IPC chokepoint
 * (`core::paths::canonicalize_no_verbatim`). See `docs/architecture.md`
 * rule 15 and `docs/security.md` rule 11.
 *
 * Fields touched: `root`, `activeTabPath`, `tabs[].path`,
 * `recentItems[].path` (with re-dedupe by post-strip path, keeping the
 * newest timestamp), and the keys of `expandedFolders`.
 */
export function migrateV1StripVerbatim(persistedState: unknown): unknown {
  const s = (persistedState ?? {}) as PersistedUI;
  if (typeof s.root === "string") {
    s.root = stripVerbatimPrefix(s.root);
  }
  if (typeof s.activeTabPath === "string") {
    s.activeTabPath = stripVerbatimPrefix(s.activeTabPath);
  }
  if (Array.isArray(s.tabs)) {
    s.tabs = s.tabs.map((t) => ({ ...t, path: stripVerbatimPrefix(t.path) }));
  }
  if (Array.isArray(s.recentItems)) {
    // Strip first, then re-dedupe by post-strip path keeping the most
    // recent timestamp so a workspace that was opened both through the
    // dialog (`C:\…`) and through an OS handler (`\\?\C:\…`) collapses
    // to a single entry. Sort newest-first so subsequent UI consumers
    // (recent menu) render in order.
    const stripped = s.recentItems.map((r) => ({
      ...r,
      path: stripVerbatimPrefix(r.path),
    }));
    const byPath = new Map<string, RecentItem>();
    for (const r of stripped) {
      const prior = byPath.get(r.path);
      if (!prior || r.timestamp > prior.timestamp) {
        byPath.set(r.path, r);
      }
    }
    s.recentItems = Array.from(byPath.values()).sort(
      (a, b) => b.timestamp - a.timestamp,
    );
  }
  if (s.expandedFolders && typeof s.expandedFolders === "object") {
    const next: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(s.expandedFolders)) {
      next[stripVerbatimPrefix(k)] = v;
    }
    s.expandedFolders = next;
  }
  return s;
}
