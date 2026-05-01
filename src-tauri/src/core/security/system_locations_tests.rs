//! Unit tests for [`super::classify`].
//!
//! HOME-mutating tests serialize via `TEST_ENV_LOCK` because `cargo test` runs
//! in-binary tests in parallel by default and we deliberately do NOT pull in
//! the `serial_test` crate (lean review: no new dev-deps).

use super::*;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

static TEST_ENV_LOCK: Mutex<()> = Mutex::new(());

#[cfg(unix)]
const HOME_VAR: &str = "HOME";
#[cfg(windows)]
const HOME_VAR: &str = "USERPROFILE";

struct EnvGuard {
    key: &'static str,
    prev: Option<std::ffi::OsString>,
}

impl EnvGuard {
    fn set(key: &'static str, value: &Path) -> Self {
        let prev = std::env::var_os(key);
        // Tests holding `TEST_ENV_LOCK` serialize all env mutations
        // performed by this module.
        std::env::set_var(key, value);
        Self { key, prev }
    }
}

impl Drop for EnvGuard {
    fn drop(&mut self) {
        // Lock is held by the test that created this guard.
        match &self.prev {
            Some(v) => std::env::set_var(self.key, v),
            None => std::env::remove_var(self.key),
        }
    }
}

// ---------- Inside / Outside ------------------------------------------------

#[cfg(unix)]
#[test]
fn classify_inside_workspace() {
    let workspace = Path::new("/tmp/work");
    let file = Path::new("/tmp/work/file.md");
    assert_eq!(classify(file, workspace).unwrap(), Tier::Inside);
}

#[cfg(unix)]
#[test]
fn classify_outside_workspace_non_system() {
    let workspace = Path::new("/tmp/work");
    let file = Path::new("/tmp/other/file.md");
    assert_eq!(classify(file, workspace).unwrap(), Tier::Outside);
}

// ---------- POSIX system ---------------------------------------------------

#[cfg(unix)]
#[test]
fn classify_posix_system_etc() {
    let workspace = Path::new("/tmp/work");
    let file = Path::new("/etc/passwd");
    assert_eq!(
        classify(file, workspace).unwrap(),
        Tier::System {
            flavor: SystemFlavor::Posix
        }
    );
}

#[cfg(unix)]
#[test]
fn classify_posix_system_root() {
    let workspace = Path::new("/tmp/work");
    let file = Path::new("/root/.bashrc");
    assert_eq!(
        classify(file, workspace).unwrap(),
        Tier::System {
            flavor: SystemFlavor::Posix
        }
    );
}

// On macOS, `/etc` is a symlink to `/private/etc` and `/var` is a symlink to
// `/private/var`. `canonicalize_no_verbatim` returns the post-resolve form, so
// the deny list must include the canonical paths or `/etc/passwd` (which
// resolves to `/private/etc/passwd`) would slip through every prefix match.
#[cfg(unix)]
#[test]
fn classify_posix_system_macos_canonical_etc() {
    let workspace = Path::new("/tmp/work");
    let file = Path::new("/private/etc/passwd");
    assert_eq!(
        classify(file, workspace).unwrap(),
        Tier::System {
            flavor: SystemFlavor::Posix
        }
    );
}

#[cfg(unix)]
#[test]
fn classify_posix_system_macos_canonical_var() {
    let workspace = Path::new("/tmp/work");
    let file = Path::new("/private/var/log/system.log");
    assert_eq!(
        classify(file, workspace).unwrap(),
        Tier::System {
            flavor: SystemFlavor::Posix
        }
    );
}

// ---------- Windows system -------------------------------------------------

#[cfg(windows)]
#[test]
fn classify_windows_system() {
    let workspace = Path::new(r"C:\work");
    let file = Path::new(r"C:\Windows\System32\cmd.exe");
    assert_eq!(
        classify(file, workspace).unwrap(),
        Tier::System {
            flavor: SystemFlavor::Windows
        }
    );
}

#[cfg(windows)]
#[test]
fn classify_unc() {
    let workspace = Path::new(r"C:\work");
    let file = Path::new(r"\\server\share\x.md");
    assert_eq!(
        classify(file, workspace).unwrap(),
        Tier::System {
            flavor: SystemFlavor::Unc
        }
    );
}

// ---------- HOME-relative --------------------------------------------------

#[test]
fn classify_home_ssh() {
    let _g = TEST_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home: PathBuf = if cfg!(windows) {
        PathBuf::from(r"C:\Users\testuser-ssh-case")
    } else {
        PathBuf::from("/home/testuser-ssh-case")
    };
    let _env = EnvGuard::set(HOME_VAR, &home);

    let workspace: PathBuf = if cfg!(windows) {
        PathBuf::from(r"C:\work")
    } else {
        PathBuf::from("/tmp/work")
    };
    let file = home.join(".ssh").join("id_rsa");

    let expected_flavor = if cfg!(windows) {
        SystemFlavor::Windows
    } else {
        SystemFlavor::Posix
    };
    assert_eq!(
        classify(&file, &workspace).unwrap(),
        Tier::System {
            flavor: expected_flavor
        }
    );
}

#[test]
fn classify_home_netrc() {
    let _g = TEST_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home: PathBuf = if cfg!(windows) {
        PathBuf::from(r"C:\Users\testuser-netrc-case")
    } else {
        PathBuf::from("/home/testuser-netrc-case")
    };
    let _env = EnvGuard::set(HOME_VAR, &home);

    let workspace: PathBuf = if cfg!(windows) {
        PathBuf::from(r"C:\work")
    } else {
        PathBuf::from("/tmp/work")
    };
    let file = home.join(".netrc");

    let expected_flavor = if cfg!(windows) {
        SystemFlavor::Windows
    } else {
        SystemFlavor::Posix
    };
    assert_eq!(
        classify(&file, &workspace).unwrap(),
        Tier::System {
            flavor: expected_flavor
        }
    );
}

// ---------- Rejections -----------------------------------------------------

#[cfg(unix)]
#[test]
fn classify_rejects_dot_dot() {
    let workspace = Path::new("/tmp/work");
    let file = Path::new("/tmp/work/../etc/passwd");
    let err = classify(file, workspace).unwrap_err();
    assert_eq!(err.reason, "contains-dot-dot");
}

#[test]
fn classify_rejects_relative() {
    let workspace = if cfg!(windows) {
        Path::new(r"C:\work")
    } else {
        Path::new("/tmp/work")
    };
    let file = Path::new("file.md");
    let err = classify(file, workspace).unwrap_err();
    assert_eq!(err.reason, "not-absolute");
}

#[cfg(windows)]
#[test]
fn classify_rejects_verbatim() {
    let workspace = Path::new(r"C:\work");
    let file = Path::new(r"\\?\C:\Windows\System32");
    let err = classify(file, workspace).unwrap_err();
    assert_eq!(err.reason, "verbatim-form");
}
