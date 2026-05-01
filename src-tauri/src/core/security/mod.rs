//! Security primitives shared across commands and core modules.
//!
//! Currently exposes the system-location classifier used by the
//! tiered link & asset policy (issue #338, rule 13 of `docs/security.md`).

pub mod system_locations;
