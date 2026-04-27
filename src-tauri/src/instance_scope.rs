//! Instance-scope discriminator for E2E test isolation and dev/prod coexistence.
//!
//! Production builds enforce single-instance via the default app identifier.
//! Debug builds and builds launched with `MDR_INSTANCE_ID` set skip single-instance
//! entirely, so multiple dev/test processes can run side-by-side without fighting
//! over the production mutex/lock.

/// Returns a scope discriminator string for this process.
///
/// - If `MDR_INSTANCE_ID` is set and non-empty → returns its value.
/// - Else if `cfg!(debug_assertions)` → returns `"com.mdownreview.desktop.dev"`.
/// - Else → returns `"com.mdownreview.desktop"` (production singleton).
pub fn instance_id() -> String {
    if let Ok(val) = std::env::var("MDR_INSTANCE_ID") {
        if !val.is_empty() {
            return val;
        }
    }
    if cfg!(debug_assertions) {
        "com.mdownreview.desktop.dev".to_string()
    } else {
        "com.mdownreview.desktop".to_string()
    }
}

/// Returns `true` when this process is NOT using the production scope
/// (i.e. debug build or env-tagged), meaning single-instance should be skipped.
pub fn is_isolated() -> bool {
    if std::env::var("MDR_INSTANCE_ID")
        .map(|v| !v.is_empty())
        .unwrap_or(false)
    {
        return true;
    }
    cfg!(debug_assertions)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    // Env-var tests mutate process-global state, so we serialize them.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn instance_id_returns_env_var_when_set() {
        let _lock = ENV_LOCK.lock().unwrap();
        std::env::set_var("MDR_INSTANCE_ID", "test-run-42");
        let id = instance_id();
        std::env::remove_var("MDR_INSTANCE_ID");
        assert_eq!(id, "test-run-42");
    }

    #[test]
    fn instance_id_ignores_empty_env_var() {
        let _lock = ENV_LOCK.lock().unwrap();
        std::env::set_var("MDR_INSTANCE_ID", "");
        let id = instance_id();
        std::env::remove_var("MDR_INSTANCE_ID");
        // Empty env var is treated as unset — falls through to cfg-based default.
        if cfg!(debug_assertions) {
            assert_eq!(id, "com.mdownreview.desktop.dev");
        } else {
            assert_eq!(id, "com.mdownreview.desktop");
        }
    }

    #[test]
    fn instance_id_returns_cfg_default_when_env_unset() {
        let _lock = ENV_LOCK.lock().unwrap();
        std::env::remove_var("MDR_INSTANCE_ID");
        let id = instance_id();
        if cfg!(debug_assertions) {
            assert_eq!(id, "com.mdownreview.desktop.dev");
        } else {
            assert_eq!(id, "com.mdownreview.desktop");
        }
    }

    #[test]
    fn is_isolated_true_when_env_set() {
        let _lock = ENV_LOCK.lock().unwrap();
        std::env::set_var("MDR_INSTANCE_ID", "iso-1");
        let isolated = is_isolated();
        std::env::remove_var("MDR_INSTANCE_ID");
        assert!(isolated);
    }

    #[test]
    fn is_isolated_matches_debug_cfg_when_env_unset() {
        let _lock = ENV_LOCK.lock().unwrap();
        std::env::remove_var("MDR_INSTANCE_ID");
        let isolated = is_isolated();
        // In test (debug) builds, is_isolated() should be true.
        assert_eq!(isolated, cfg!(debug_assertions));
    }
}
