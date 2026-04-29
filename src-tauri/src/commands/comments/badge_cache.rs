//! Per-file badge cache, keyed by source path with sidecar-mtime
//! fingerprint invalidation.
//!
//! Closes the gap flagged in `docs/performance.md` rule (deferred
//! note): "`get_file_badges` loads one sidecar per file per call. For
//! workspaces >500 files consider a Rust-side per-file cache
//! invalidated on `comments-changed`."
//!
//! ## Invalidation strategy
//!
//! Lazy. Each call stats the YAML and JSON sidecar paths and uses the
//! `(yaml_mtime_ms, json_mtime_ms)` pair as a fingerprint. A cache hit
//! requires BOTH mtimes to match the cached snapshot. Any mismatch
//! (mutation, deletion, format swap) recomputes and re-caches.
//!
//! Mutations through `with_sidecar_mut` change the YAML mtime via the
//! atomic-rename write path, so the next badge call detects the change
//! without needing to subscribe to `comments-changed` events on the
//! Rust side.
//!
//! ## Concurrency
//!
//! The inner `HashMap` is wrapped in a single `Mutex` rather than per-
//! entry locks. Lock scope is microseconds (lookup or insert only —
//! sidecar I/O happens outside the lock), so contention from the
//! parallel `rayon` loop in [`super::badges::get_file_badges_inner`] is
//! negligible. If profiling ever shows contention, switch to a
//! lock-free `dashmap` without changing callers.

use super::badges::FileBadge;
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

/// Resolve a filesystem mtime as milliseconds since UNIX epoch. Returns
/// `None` for missing files / unreadable metadata / pre-epoch times.
/// Public so badge callers can compute the fingerprint and pass both
/// halves through `lookup`/`insert` without a second stat.
pub fn mtime_ms(path: &str) -> Option<u128> {
    let meta = std::fs::metadata(Path::new(path)).ok()?;
    let mtime = meta.modified().ok()?;
    mtime.duration_since(SystemTime::UNIX_EPOCH).ok().map(|d| d.as_millis())
}

#[derive(Clone, Debug)]
struct CachedEntry {
    yaml_mtime_ms: Option<u128>,
    json_mtime_ms: Option<u128>,
    badge: FileBadge,
}

/// Tauri-managed cache for `get_file_badges` results.
#[derive(Default, Clone)]
pub struct BadgeCache {
    inner: Arc<Mutex<HashMap<String, CachedEntry>>>,
}

impl BadgeCache {
    /// Construct an empty cache. Tauri instantiates this once via
    /// `manage`; tests can construct ad-hoc copies.
    pub fn new() -> Self {
        Self::default()
    }

    /// Return the cached badge for `source_path` if its YAML+JSON
    /// fingerprint matches the supplied current mtimes. A `None` mtime
    /// (sidecar absent now) MUST match a `None` mtime in the cache —
    /// otherwise badges for deleted-then-recreated sidecars would
    /// stale-hit.
    pub fn lookup(
        &self,
        source_path: &str,
        current_yaml_mtime: Option<u128>,
        current_json_mtime: Option<u128>,
    ) -> Option<FileBadge> {
        let guard = self.inner.lock().ok()?;
        let entry = guard.get(source_path)?;
        if entry.yaml_mtime_ms == current_yaml_mtime
            && entry.json_mtime_ms == current_json_mtime
        {
            Some(entry.badge.clone())
        } else {
            None
        }
    }

    /// Insert (or overwrite) the badge for `source_path` with the
    /// supplied mtime fingerprint. Lock failures are silently ignored
    /// — the worst-case effect is a recompute on the next call.
    pub fn insert(
        &self,
        source_path: String,
        yaml_mtime_ms: Option<u128>,
        json_mtime_ms: Option<u128>,
        badge: FileBadge,
    ) {
        if let Ok(mut guard) = self.inner.lock() {
            guard.insert(
                source_path,
                CachedEntry {
                    yaml_mtime_ms,
                    json_mtime_ms,
                    badge,
                },
            );
        }
    }

    /// Drop the cached entry for `source_path`. Used when the badge
    /// computation produces no badge (count == 0) — keeps the cache
    /// from holding a stale `count > 0` entry across a resolve-all.
    pub fn invalidate(&self, source_path: &str) {
        if let Ok(mut guard) = self.inner.lock() {
            guard.remove(source_path);
        }
    }

    /// Test-only: number of entries currently cached.
    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.inner.lock().map(|g| g.len()).unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::severity::Severity;

    fn b(count: u32, sev: Severity) -> FileBadge {
        FileBadge { count, max_severity: sev, file_level_count: 0 }
    }

    #[test]
    fn lookup_returns_none_for_missing_entry() {
        let cache = BadgeCache::new();
        assert!(cache.lookup("/nope", Some(1), None).is_none());
    }

    #[test]
    fn insert_then_lookup_with_matching_fingerprint_returns_cached() {
        let cache = BadgeCache::new();
        cache.insert("/a".into(), Some(100), Some(200), b(3, Severity::High));
        let got = cache.lookup("/a", Some(100), Some(200)).expect("hit");
        assert_eq!(got.count, 3);
        assert_eq!(got.max_severity, Severity::High);
    }

    #[test]
    fn lookup_mismatched_yaml_mtime_returns_none() {
        let cache = BadgeCache::new();
        cache.insert("/a".into(), Some(100), None, b(1, Severity::Low));
        assert!(cache.lookup("/a", Some(101), None).is_none());
    }

    #[test]
    fn lookup_mismatched_json_mtime_returns_none() {
        let cache = BadgeCache::new();
        cache.insert("/a".into(), None, Some(50), b(1, Severity::Low));
        assert!(cache.lookup("/a", None, Some(51)).is_none());
    }

    #[test]
    fn lookup_distinguishes_none_from_some_zero() {
        // A sidecar that was just deleted has mtime None; a sidecar
        // recreated at epoch 0 has mtime Some(0). These must not
        // collide — otherwise a deleted-then-recreated badge would
        // stale-hit.
        let cache = BadgeCache::new();
        cache.insert("/a".into(), Some(0), None, b(2, Severity::Medium));
        assert!(cache.lookup("/a", None, None).is_none());
        assert!(cache.lookup("/a", Some(0), None).is_some());
    }

    #[test]
    fn invalidate_drops_entry() {
        let cache = BadgeCache::new();
        cache.insert("/a".into(), Some(1), None, b(1, Severity::Low));
        assert_eq!(cache.len(), 1);
        cache.invalidate("/a");
        assert_eq!(cache.len(), 0);
    }

    #[test]
    fn insert_overwrites_existing_entry() {
        let cache = BadgeCache::new();
        cache.insert("/a".into(), Some(1), None, b(1, Severity::Low));
        cache.insert("/a".into(), Some(2), None, b(5, Severity::High));
        assert!(cache.lookup("/a", Some(1), None).is_none());
        let got = cache.lookup("/a", Some(2), None).expect("hit");
        assert_eq!(got.count, 5);
        assert_eq!(got.max_severity, Severity::High);
    }
}
