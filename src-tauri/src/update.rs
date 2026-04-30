use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};
use crate::mdr_command;

const STABLE_ENDPOINT: &str =
    "https://github.com/dryotta/mdownreview/releases/latest/download/latest.json";
const CANARY_ENDPOINT: &str =
    "https://github.com/dryotta/mdownreview/releases/download/canary/canary-latest.json";

/// Holds the Update object between check and install so the frontend
/// can show a banner and the user can decide when to install.
pub struct PendingUpdate(pub Mutex<Option<Update>>);

#[derive(serde::Serialize, Clone, specta::Type)]
pub struct UpdateInfo {
    pub version: String,
    pub body: Option<String>,
}

#[derive(Clone, serde::Serialize)]
struct UpdateProgressEvent {
    event: String,
    content_length: Option<u64>,
    chunk_length: usize,
}

fn endpoint_for_channel(channel: &str) -> &'static str {
    match channel {
        "canary" => CANARY_ENDPOINT,
        _ => STABLE_ENDPOINT,
    }
}

/// Derive the channel ("canary" or "stable") from a version string.
/// Canary builds are identified by a pre-release suffix (e.g. "0.3.4-2").
/// Stable releases have no pre-release component (e.g. "0.3.4").
fn channel_from_version(version: &str) -> &'static str {
    if version.contains('-') {
        "canary"
    } else {
        "stable"
    }
}

/// Derive the installed channel from the current app version string.
fn installed_channel(app: &AppHandle) -> &'static str {
    let version = app.config().version.clone().unwrap_or_default();
    channel_from_version(&version)
}

/// Check for an update on the given channel.
/// For cross-channel switches the version comparator is overridden
/// to accept any different version (enabling "downgrades").
#[mdr_command]
pub async fn check_update(app: AppHandle, channel: String) -> Result<Option<UpdateInfo>, String> {
    let endpoint = endpoint_for_channel(&channel);
    let cross_channel = installed_channel(&app) != channel.as_str();

    let url: url::Url = endpoint
        .parse()
        .map_err(|e: url::ParseError| e.to_string())?;
    let mut builder = app
        .updater_builder()
        .endpoints(vec![url])
        .map_err(|e| e.to_string())?;

    if cross_channel {
        builder = builder.version_comparator(|_current, _remote| true);
    }

    let updater = builder.build().map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| e.to_string())?;

    match update {
        Some(u) => {
            let info = UpdateInfo {
                version: u.version.clone(),
                body: u.body.clone(),
            };
            let state = app.state::<PendingUpdate>();
            *state.0.lock().unwrap() = Some(u);
            Ok(Some(info))
        }
        None => Ok(None),
    }
}

/// Download and install the pending update. Emits "update-progress"
/// events so the frontend can show a progress bar.
#[mdr_command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    let update = {
        let state = app.state::<PendingUpdate>();
        let taken = state.0.lock().unwrap().take();
        taken
    };

    let update = update.ok_or_else(|| "No pending update to install".to_string())?;
    let app_handle = app.clone();
    let app_finish = app.clone();

    update
        .download_and_install(
            move |chunk_length, content_length| {
                let payload = UpdateProgressEvent {
                    event: if content_length.is_some() && chunk_length == 0 {
                        "Started".into()
                    } else {
                        "Progress".into()
                    },
                    content_length,
                    chunk_length,
                };
                let _ = Emitter::emit(&app_handle, "update-progress", payload);
            },
            move || {
                let payload = UpdateProgressEvent {
                    event: "Finished".into(),
                    content_length: None,
                    chunk_length: 0,
                };
                let _ = Emitter::emit(&app_finish, "update-progress", payload);
            },
        )
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::channel_from_version;

    #[test]
    fn stable_version_returns_stable() {
        assert_eq!(channel_from_version("0.3.4"), "stable");
        assert_eq!(channel_from_version("1.0.0"), "stable");
        assert_eq!(channel_from_version("0.0.1"), "stable");
    }

    #[test]
    fn canary_numeric_suffix_returns_canary() {
        assert_eq!(channel_from_version("0.3.4-2"), "canary");
        assert_eq!(channel_from_version("0.3.4-10"), "canary");
        assert_eq!(channel_from_version("1.0.0-1"), "canary");
    }

    #[test]
    fn empty_version_returns_stable() {
        assert_eq!(channel_from_version(""), "stable");
    }
}

#[cfg(test)]
mod event_payload_tests {
    use super::*;

    /// Pins the JSON wire shape of `UpdateProgressEvent`. Mirror of
    /// `ipc_event_payloads_serialize_to_frontend_contract` in
    /// `src-tauri/src/watcher_tests.rs`. See `EventPayloads["update-progress"]`
    /// in `src/lib/tauri-events.ts` and the `updateProgress` fixture in
    /// `src/__tests__/fixtures/ipc-event-fixtures.ts`.
    #[test]
    fn update_progress_event_serializes_to_frontend_contract() {
        use serde_json::json;

        // event="Started" — emitted at update.rs:108 from the chunk callback
        // when content_length is known and chunk_length == 0.
        assert_eq!(
            serde_json::to_value(UpdateProgressEvent {
                event: "Started".to_string(),
                content_length: Some(1000),
                chunk_length: 0,
            })
            .unwrap(),
            json!({ "event": "Started", "content_length": 1000, "chunk_length": 0 }),
            "UpdateProgressEvent event=Started wire shape drifted from frontend contract"
        );

        // event="Progress" — emitted at update.rs:110 during chunk download.
        assert_eq!(
            serde_json::to_value(UpdateProgressEvent {
                event: "Progress".to_string(),
                content_length: None,
                chunk_length: 500,
            })
            .unwrap(),
            json!({ "event": "Progress", "content_length": null, "chunk_length": 500 }),
            "UpdateProgressEvent event=Progress wire shape drifted from frontend contract"
        );

        // event="Finished" — emitted at update.rs:119 from the finish callback.
        assert_eq!(
            serde_json::to_value(UpdateProgressEvent {
                event: "Finished".to_string(),
                content_length: None,
                chunk_length: 0,
            })
            .unwrap(),
            json!({ "event": "Finished", "content_length": null, "chunk_length": 0 }),
            "UpdateProgressEvent event=Finished wire shape drifted from frontend contract"
        );
    }
}
