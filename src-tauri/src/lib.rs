pub mod commands;

use commands::LaunchArgsState;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};
use tauri_plugin_log::{Target, TargetKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let log_plugin = {
        let mut builder = tauri_plugin_log::Builder::new()
            .max_file_size(5 * 1024 * 1024)
            .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepAll);

        #[cfg(debug_assertions)]
        {
            builder = builder
                .level(log::LevelFilter::Debug)
                .targets([
                    Target::new(TargetKind::Webview),
                    Target::new(TargetKind::LogDir {
                        file_name: Some("mdown-review".to_string()),
                    }),
                    Target::new(TargetKind::Stdout),
                ]);
        }
        #[cfg(not(debug_assertions))]
        {
            builder = builder
                .level(log::LevelFilter::Info)
                .targets([
                    Target::new(TargetKind::Webview).filter(|metadata| {
                        metadata.level() <= log::Level::Warn
                    }),
                    Target::new(TargetKind::LogDir {
                        file_name: Some("mdown-review".to_string()),
                    }),
                ]);
        }

        builder.build()
    };

    tauri::Builder::default()
        .plugin(log_plugin)
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(
            tauri_plugin_single_instance::init(|app, argv, _cwd| {
                // Second-instance: classify args and emit event to existing window
                let mut files = Vec::new();
                let mut folders = Vec::new();
                for arg in argv.iter().skip(1) {
                    match std::fs::metadata(arg) {
                        Ok(meta) if meta.is_dir() => folders.push(arg.clone()),
                        Ok(_) => files.push(arg.clone()),
                        Err(_) => {}
                    }
                }
                let payload = serde_json::json!({ "files": files, "folders": folders });
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.emit("args-received", payload);
                }
            })
        )
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // Register panic hook to log panics before process terminates
            let prev_hook = std::panic::take_hook();
            std::panic::set_hook(Box::new(move |info| {
                let msg = info
                    .payload()
                    .downcast_ref::<&str>()
                    .copied()
                    .or_else(|| info.payload().downcast_ref::<String>().map(|s| s.as_str()))
                    .unwrap_or("unknown panic");
                let location = info
                    .location()
                    .map(|l| format!(" at {}:{}", l.file(), l.line()))
                    .unwrap_or_default();
                log::error!("[rust] PANIC{}: {}", location, msg);
                prev_hook(info);
            }));

            // Parse CLI args and classify each as file or folder
            let args: Vec<String> = std::env::args().skip(1).collect();
            let mut files = Vec::new();
            let mut folders = Vec::new();
            for arg in &args {
                match std::fs::metadata(arg) {
                    Ok(meta) if meta.is_dir() => folders.push(arg.clone()),
                    Ok(_) => files.push(arg.clone()),
                    Err(_) => {}
                }
            }
            let launch_args = commands::LaunchArgs { files, folders };
            let state: LaunchArgsState = Arc::new(Mutex::new(Some(launch_args)));
            app.manage(state);

            // macOS: register Apple Event open_file handler
            #[cfg(target_os = "macos")]
            {
                let app_handle = app.handle().clone();
                app.on_url_open(move |urls| {
                    let mut files = Vec::new();
                    let mut folders = Vec::new();
                    for url in &urls {
                        if let Some(path) = url.to_file_path().ok() {
                            let path_str = path.to_string_lossy().into_owned();
                            match std::fs::metadata(&path_str) {
                                Ok(meta) if meta.is_dir() => folders.push(path_str),
                                Ok(_) => files.push(path_str),
                                Err(_) => {}
                            }
                        }
                    }
                    if files.is_empty() && folders.is_empty() {
                        return;
                    }
                    // If window is already running, emit event; otherwise update state
                    let state = app_handle.state::<LaunchArgsState>();
                    let mut guard = state.lock().unwrap();
                    if guard.is_none() {
                        // Window already running — emit args-received event
                        drop(guard);
                        let payload = serde_json::json!({ "files": files, "folders": folders });
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.emit("args-received", payload);
                        }
                    } else {
                        *guard = Some(commands::LaunchArgs { files, folders });
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::read_dir,
            commands::read_text_file,
            commands::save_review_comments,
            commands::load_review_comments,
            commands::get_launch_args,
            commands::get_log_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
