//! System-location classifier — foundation for the tiered link & asset policy
//! (issue #338, rule 13 of `docs/security.md`).
//!
//! Given a *canonical* (absolute, dot-dot-free, non-verbatim) path and the
//! workspace root, classifies the path into one of three tiers:
//!
//! * [`Tier::Inside`]  — inside the workspace (allowed by default).
//! * [`Tier::System`]  — sensitive system / user-secret location (always blocked).
//! * [`Tier::Outside`] — outside the workspace, not system (caller decides).
//!
//! This module is **Rust-internal**: the [`Tier`], [`SystemFlavor`] and
//! [`NonCanonicalErr`] types are `pub(crate)` and never cross the IPC boundary
//! (no `#[specta::specta]`, no `Serialize`).

use std::path::{Component, Path, PathBuf};
#[cfg(not(test))]
use std::sync::OnceLock;

// ---------------------------------------------------------------------------
// Const tables — audited as part of rule 13 of `docs/security.md`.
// ---------------------------------------------------------------------------

/// POSIX system locations — rule 13 of `docs/security.md`.
const POSIX_SYSTEM_PREFIXES: &[&str] = &[
    "/etc/",
    "/proc/",
    "/sys/",
    "/dev/",
    "/var/log/",
    "/root/",
    "/var/lib/",
    "/run/",
    "/boot/",
    // macOS resolves /etc -> /private/etc and /var -> /private/var via
    // symlinks; canonicalize_no_verbatim returns the post-resolve form, so
    // the literal canonical paths must also be in the deny list. Without
    // these, `/etc/passwd` would canonicalize to `/private/etc/passwd` and
    // bypass the prefix match entirely (security regression on macOS).
    "/private/etc/",
    "/private/var/",
];

/// HOME-relative directory prefixes (joined with `$HOME` / `%USERPROFILE%` at runtime).
const HOME_RELATIVE_DIR_PREFIXES: &[&str] = &[
    ".ssh", ".aws", ".config", ".kube", ".docker", ".gnupg", ".azure",
];

/// HOME-relative literal-file matches.
const HOME_RELATIVE_FILES: &[&str] = &[".netrc", ".pgpass", ".bash_history", ".zsh_history"];

/// Windows system locations — rule 13 of `docs/security.md`.
const WINDOWS_SYSTEM_PREFIXES: &[&str] = &[r"C:\Windows\", r"C:\ProgramData\"];

/// Substring marker for per-user AppData (joined under `C:\Users\<user>\AppData\`).
const WINDOWS_APPDATA_SUBSTRING: &str = r"\AppData\";

// ---------------------------------------------------------------------------
// Public(crate) types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SystemFlavor {
    Posix,
    Windows,
    Unc,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Tier {
    /// Canonical path is inside `workspace_root`.
    Inside,
    /// Outside the workspace and NOT a known system location.
    Outside,
    /// Sensitive system / user-secret location.
    System { flavor: SystemFlavor },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct NonCanonicalErr {
    pub reason: &'static str,
}

impl NonCanonicalErr {
    const fn new(reason: &'static str) -> Self {
        Self { reason }
    }
}

// ---------------------------------------------------------------------------
// HOME snapshot
// ---------------------------------------------------------------------------

fn read_home_env() -> Option<PathBuf> {
    #[cfg(unix)]
    {
        std::env::var_os("HOME").map(PathBuf::from)
    }
    #[cfg(windows)]
    {
        std::env::var_os("USERPROFILE").map(PathBuf::from)
    }
    #[cfg(not(any(unix, windows)))]
    {
        None
    }
}

/// Returns the user's home directory.
///
/// In production builds this is captured once via [`OnceLock`] so the classifier
/// stays deterministic for the life of the process. Test builds re-read the
/// environment on every call so unit tests can override `HOME` /
/// `USERPROFILE` deterministically.
fn home_dir() -> Option<PathBuf> {
    #[cfg(test)]
    {
        read_home_env()
    }
    #[cfg(not(test))]
    {
        static HOME: OnceLock<Option<PathBuf>> = OnceLock::new();
        HOME.get_or_init(read_home_env).clone()
    }
}

// ---------------------------------------------------------------------------
// Verbatim / UNC detection (Windows)
// ---------------------------------------------------------------------------

#[cfg(windows)]
fn is_verbatim(p: &Path) -> bool {
    use std::path::Prefix;
    if let Some(Component::Prefix(pc)) = p.components().next() {
        matches!(
            pc.kind(),
            Prefix::Verbatim(_) | Prefix::VerbatimDisk(_) | Prefix::VerbatimUNC(_, _)
        )
    } else {
        false
    }
}

#[cfg(not(windows))]
fn is_verbatim(_p: &Path) -> bool {
    false
}

#[cfg(windows)]
fn is_unc(p: &Path) -> bool {
    use std::path::Prefix;
    if let Some(Component::Prefix(pc)) = p.components().next() {
        matches!(pc.kind(), Prefix::UNC(_, _))
    } else {
        false
    }
}

#[cfg(not(windows))]
fn is_unc(_p: &Path) -> bool {
    false
}

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

/// Classifies `canonical` relative to `workspace_root`.
///
/// `canonical` MUST already be the simplified canonical form produced by
/// `core::paths::canonicalize_no_verbatim` — absolute, free of `..` segments,
/// and (on Windows) not a verbatim `\\?\…` path. Violations return
/// [`NonCanonicalErr`] so callers cannot accidentally launder unsafe input.
pub(crate) fn classify(
    canonical: &Path,
    workspace_root: &Path,
) -> Result<Tier, NonCanonicalErr> {
    // Reject `..` segments.
    if canonical
        .components()
        .any(|c| matches!(c, Component::ParentDir))
    {
        return Err(NonCanonicalErr::new("contains-dot-dot"));
    }
    // Reject relative paths.
    if !canonical.is_absolute() {
        return Err(NonCanonicalErr::new("not-absolute"));
    }
    // Reject Windows verbatim paths — caller MUST simplify first
    // (rule 11a of `docs/architecture.md`).
    if is_verbatim(canonical) {
        return Err(NonCanonicalErr::new("verbatim-form"));
    }

    // ---- System checks first --------------------------------------------
    if is_unc(canonical) {
        return Ok(Tier::System {
            flavor: SystemFlavor::Unc,
        });
    }

    let canon_str = canonical.to_string_lossy();

    // POSIX system prefixes (also evaluated on Windows; the literal forward
    // slashes won't accidentally match a Windows path).
    for prefix in POSIX_SYSTEM_PREFIXES {
        if canon_str.starts_with(prefix) {
            return Ok(Tier::System {
                flavor: SystemFlavor::Posix,
            });
        }
    }

    // Windows system prefixes + AppData substring.
    for prefix in WINDOWS_SYSTEM_PREFIXES {
        if canon_str.starts_with(prefix) {
            return Ok(Tier::System {
                flavor: SystemFlavor::Windows,
            });
        }
    }
    if canon_str.starts_with(r"C:\Users\") && canon_str.contains(WINDOWS_APPDATA_SUBSTRING) {
        return Ok(Tier::System {
            flavor: SystemFlavor::Windows,
        });
    }

    // HOME-relative directory + literal-file matches.
    if let Some(home) = home_dir() {
        let home_flavor = if cfg!(windows) {
            SystemFlavor::Windows
        } else {
            SystemFlavor::Posix
        };
        for dir in HOME_RELATIVE_DIR_PREFIXES {
            if canonical.starts_with(home.join(dir)) {
                return Ok(Tier::System {
                    flavor: home_flavor,
                });
            }
        }
        for file in HOME_RELATIVE_FILES {
            if canonical == home.join(file) {
                return Ok(Tier::System {
                    flavor: home_flavor,
                });
            }
        }
    }

    // ---- Workspace membership -------------------------------------------
    if canonical.starts_with(workspace_root) {
        Ok(Tier::Inside)
    } else {
        Ok(Tier::Outside)
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Wire conversion (issue #338 / Group B)
// ---------------------------------------------------------------------------
//
// One-way dependency: `core::types::wire` does NOT import this module; this
// module imports the wire shape and provides the (Tier, canonical) -> wire
// conversion. The internal `Tier` / `SystemFlavor` stay `pub(crate)` so the
// IPC boundary cannot accidentally serialise the raw policy primitive.
//
// The `Tier::Inside` / `Tier::Outside` variants are unit (no payload), so the
// conversion takes the canonical path as a separate parameter rather than
// adding a `canonical: PathBuf` field to those variants — keeps the
// classifier's hot path allocation-free.

use crate::core::types::wire::{PathClassification, PathClassificationFlavor};

impl From<SystemFlavor> for PathClassificationFlavor {
    fn from(f: SystemFlavor) -> Self {
        match f {
            SystemFlavor::Posix => PathClassificationFlavor::Posix,
            SystemFlavor::Windows => PathClassificationFlavor::Windows,
            SystemFlavor::Unc => PathClassificationFlavor::Unc,
        }
    }
}

/// Convert an internal classification + its canonical path into the wire
/// `PathClassification`. Note the `System` variant intentionally drops the
/// canonical (defense-in-depth — never echo a system path to the UI).
pub(crate) fn tier_to_wire(t: &Tier, canonical: &Path) -> PathClassification {
    match t {
        Tier::Inside => PathClassification::Inside {
            canonical: canonical.to_string_lossy().into_owned(),
        },
        Tier::Outside => PathClassification::Outside {
            canonical: canonical.to_string_lossy().into_owned(),
        },
        Tier::System { flavor } => PathClassification::System {
            flavor: PathClassificationFlavor::from(*flavor),
        },
    }
}

#[cfg(test)]
#[path = "system_locations_tests.rs"]
mod tests;
