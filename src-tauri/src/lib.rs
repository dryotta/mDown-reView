pub mod commands;

use commands::LaunchArgsState;
use std::sync::{Arc, Mutex};
use tauri::menu::{MenuBuilder, MenuItem, SubmenuBuilder};
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

    let app = tauri::Builder::default()
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

            // ── Build application menu ────────────────────────────────────────

            // File menu
            let open_folder = MenuItem::with_id(app, "open-folder", "Open Folder…", true, Some("CmdOrCtrl+O"))?;
            let close_tab = MenuItem::with_id(app, "close-tab", "Close Tab", true, Some("CmdOrCtrl+W"))?;
            let close_all_tabs = MenuItem::with_id(app, "close-all-tabs", "Close All Tabs", true, Some("CmdOrCtrl+Shift+W"))?;
            let file_menu = SubmenuBuilder::new(app, "File")
                .item(&open_folder)
                .separator()
                .item(&close_tab)
                .item(&close_all_tabs)
                .separator()
                .quit()
                .build()?;

            // View menu — panes
            let toggle_folder_pane = MenuItem::with_id(app, "toggle-folder-pane", "Toggle Folder Pane", true, Some("CmdOrCtrl+B"))?;
            let toggle_comments_pane = MenuItem::with_id(app, "toggle-comments-pane", "Toggle Comments Pane", true, Some("CmdOrCtrl+Shift+C"))?;
            // View menu — tab navigation
            let next_tab = MenuItem::with_id(app, "next-tab", "Next Tab", true, None::<&str>)?;
            let prev_tab = MenuItem::with_id(app, "prev-tab", "Previous Tab", true, None::<&str>)?;
            // View menu — folder tree
            let expand_all = MenuItem::with_id(app, "expand-all", "Expand All", true, None::<&str>)?;
            let collapse_all = MenuItem::with_id(app, "collapse-all", "Collapse All", true, None::<&str>)?;
            // View menu — theme submenu
            let theme_system = MenuItem::with_id(app, "theme-system", "System Theme", true, None::<&str>)?;
            let theme_light = MenuItem::with_id(app, "theme-light", "Light Theme", true, None::<&str>)?;
            let theme_dark = MenuItem::with_id(app, "theme-dark", "Dark Theme", true, None::<&str>)?;
            let theme_menu = SubmenuBuilder::new(app, "Theme")
                .item(&theme_system)
                .item(&theme_light)
                .item(&theme_dark)
                .build()?;
            let view_menu = SubmenuBuilder::new(app, "View")
                .item(&toggle_folder_pane)
                .item(&toggle_comments_pane)
                .separator()
                .item(&next_tab)
                .item(&prev_tab)
                .separator()
                .item(&expand_all)
                .item(&collapse_all)
                .separator()
                .item(&theme_menu)
                .build()?;

            // Help menu
            let about_item = MenuItem::with_id(app, "about", "About mDown reView", true, None::<&str>)?;
            let check_updates = MenuItem::with_id(app, "check-updates", "Check for Updates…", true, None::<&str>)?;
            let help_menu = SubmenuBuilder::new(app, "Help")
                .item(&about_item)
                .separator()
                .item(&check_updates)
                .build()?;

            let menu = MenuBuilder::new(app)
                .item(&file_menu)
                .item(&view_menu)
                .item(&help_menu)
                .build()?;

            app.set_menu(menu)?;

            // Forward menu events to the frontend as Tauri events
            app.on_menu_event(|app, event| {
                let Some(window) = app.get_webview_window("main") else { return };
                let event_name = match event.id().as_ref() {
                    "open-folder" => "menu-open-folder",
                    "close-tab" => "menu-close-tab",
                    "close-all-tabs" => "menu-close-all-tabs",
                    "toggle-folder-pane" => "menu-toggle-folder-pane",
                    "toggle-comments-pane" => "menu-toggle-comments-pane",
                    "next-tab" => "menu-next-tab",
                    "prev-tab" => "menu-prev-tab",
                    "expand-all" => "menu-expand-all",
                    "collapse-all" => "menu-collapse-all",
                    "theme-system" => "menu-theme-system",
                    "theme-light" => "menu-theme-light",
                    "theme-dark" => "menu-theme-dark",
                    "about" => "menu-about",
                    "check-updates" => "menu-check-updates",
                    _ => return,
                };
                let _ = window.emit(event_name, ());
            });

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
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // macOS / iOS: handle "Open With" file URLs via RunEvent::Opened.
    // on_url_open() was removed in Tauri 2.x; RunEvent::Opened is the replacement.
    app.run(|app_handle, event| {
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let tauri::RunEvent::Opened { urls } = &event {
            let mut files = Vec::new();
            let mut folders = Vec::new();
            for url in urls {
                if let Ok(path) = url.to_file_path() {
                    let path_str = path.to_string_lossy().into_owned();
                    match std::fs::metadata(&path_str) {
                        Ok(meta) if meta.is_dir() => folders.push(path_str),
                        Ok(_) => files.push(path_str),
                        Err(_) => {}
                    }
                }
            }
            if !files.is_empty() || !folders.is_empty() {
                let state = app_handle.state::<LaunchArgsState>();
                let mut guard = state.lock().unwrap();
                if guard.is_none() {
                    drop(guard);
                    let payload = serde_json::json!({ "files": files, "folders": folders });
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.emit("args-received", payload);
                    }
                } else {
                    *guard = Some(commands::LaunchArgs { files, folders });
                }
            }
        }
        let _ = (app_handle, event);
    });
}
