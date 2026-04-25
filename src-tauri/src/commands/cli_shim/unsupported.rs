//! Fallback for non-mac/non-windows targets. Surfaces `Unsupported` so the FE
//! can hide the affordance entirely.

use super::{CliShimError, CliShimStatus};
use tauri::AppHandle;

pub fn status(_app: &AppHandle) -> CliShimStatus {
    CliShimStatus::Unsupported
}

pub fn install(_app: &AppHandle) -> Result<(), CliShimError> {
    Err(CliShimError::Io {
        message: "unsupported on this platform".into(),
    })
}

pub fn remove(_app: &AppHandle) -> Result<(), CliShimError> {
    Err(CliShimError::Io {
        message: "unsupported on this platform".into(),
    })
}
