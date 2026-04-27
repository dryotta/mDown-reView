pub mod commands;
pub mod core;
pub mod update;
pub mod watcher;

use commands::{parse_launch_args, push_pending, PendingArgsState};
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
            builder = builder.level(log::LevelFilter::Debug).targets([
                Target::new(TargetKind::Webview),
                Target::new(TargetKind::LogDir {
                    file_name: Some("mdownreview".to_string()),
                }),
                Target::new(TargetKind::Stdout),
            ]);
        }
        #[cfg(not(debug_assertions))]
        {
            builder = builder.level(log::LevelFilter::Info).targets([
                Target::new(TargetKind::Webview)
                    .filter(|metadata| metadata.level() <= log::Level::Warn),
                Target::new(TargetKind::LogDir {
                    file_name: Some("mdownreview".to_string()),
                }),
            ]);
        }

        builder.build()
    };

    let (sync_tx, sync_rx) = std::sync::mpsc::sync_channel::<()>(1);

    let app = tauri::Builder::default()
        .plugin(log_plugin)
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            let cwd_path = std::path::PathBuf::from(&cwd);
            let args = parse_launch_args(&argv[1..], &cwd_path);
            if let Some(state) = app.try_state::<PendingArgsState>() {
                push_pending(&state, args);
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.emit("args-received", ());
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(update::PendingUpdate(std::sync::Mutex::new(None)))
        .manage(watcher::WatcherState::new(sync_tx))
        .manage(watcher::SyncRx(std::sync::Mutex::new(Some(sync_rx))))
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

            // Parse CLI args: support --folder <path> and --file <path> flags
            let raw_args: Vec<String> = std::env::args().skip(1).collect();
            let cwd = std::env::current_dir().unwrap_or_default();
            let launch_args = parse_launch_args(&raw_args, &cwd);
            let state: PendingArgsState = PendingArgsState::default();
            push_pending(&state, launch_args);
            app.manage(state);

            // ── Build application menu ────────────────────────────────────────

            // File menu
            let open_file =
                MenuItem::with_id(app, "open-file", "Open File…", true, Some("CmdOrCtrl+O"))?;
            let open_folder = MenuItem::with_id(
                app,
                "open-folder",
                "Open Folder…",
                true,
                Some("CmdOrCtrl+Shift+O"),
            )?;
            let close_folder =
                MenuItem::with_id(app, "close-folder", "Close Folder", true, None::<&str>)?;
            let close_tab =
                MenuItem::with_id(app, "close-tab", "Close Tab", true, Some("CmdOrCtrl+W"))?;
            let close_all_tabs = MenuItem::with_id(
                app,
                "close-all-tabs",
                "Close All Tabs",
                true,
                Some("CmdOrCtrl+Shift+W"),
            )?;
            let open_settings = MenuItem::with_id(
                app,
                "open-settings",
                "Settings…",
                true,
                Some("CmdOrCtrl+,"),
            )?;
            let file_menu = SubmenuBuilder::new(app, "File")
                .item(&open_file)
                .item(&open_folder)
                .item(&close_folder)
                .separator()
                .item(&close_tab)
                .item(&close_all_tabs)
                .separator()
                .item(&open_settings)
                .separator()
                .quit()
                .build()?;

            // View menu
            let toggle_comments_pane = MenuItem::with_id(
                app,
                "toggle-comments-pane",
                "Toggle Comments Pane",
                true,
                Some("CmdOrCtrl+Shift+C"),
            )?;
            let next_tab = MenuItem::with_id(app, "next-tab", "Next Tab", true, None::<&str>)?;
            let prev_tab = MenuItem::with_id(app, "prev-tab", "Previous Tab", true, None::<&str>)?;
            let theme_system =
                MenuItem::with_id(app, "theme-system", "System Theme", true, None::<&str>)?;
            let theme_light =
                MenuItem::with_id(app, "theme-light", "Light Theme", true, None::<&str>)?;
            let theme_dark =
                MenuItem::with_id(app, "theme-dark", "Dark Theme", true, None::<&str>)?;
            let theme_menu = SubmenuBuilder::new(app, "Theme")
                .item(&theme_system)
                .item(&theme_light)
                .item(&theme_dark)
                .build()?;
            let view_menu = SubmenuBuilder::new(app, "View")
                .item(&toggle_comments_pane)
                .separator()
                .item(&next_tab)
                .item(&prev_tab)
                .separator()
                .item(&theme_menu)
                .build()?;

            // Help menu
            let help_settings =
                MenuItem::with_id(app, "help-settings", "Settings…", true, None::<&str>)?;
            let about_item =
                MenuItem::with_id(app, "about", "About mdownreview", true, None::<&str>)?;
            let check_updates = MenuItem::with_id(
                app,
                "check-updates",
                "Check for Updates…",
                true,
                None::<&str>,
            )?;
            let help_menu = SubmenuBuilder::new(app, "Help")
                .item(&help_settings)
                .separator()
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
                let Some(window) = app.get_webview_window("main") else {
                    return;
                };
                let event_name = match event.id().as_ref() {
                    "open-file" => "menu-open-file",
                    "open-folder" => "menu-open-folder",
                    "close-folder" => "menu-close-folder",
                    "close-tab" => "menu-close-tab",
                    "close-all-tabs" => "menu-close-all-tabs",
                    "toggle-comments-pane" => "menu-toggle-comments-pane",
                    "next-tab" => "menu-next-tab",
                    "prev-tab" => "menu-prev-tab",
                    "theme-system" => "menu-theme-system",
                    "theme-light" => "menu-theme-light",
                    "theme-dark" => "menu-theme-dark",
                    "about" => "menu-about",
                    "open-settings" => "menu-open-settings",
                    "check-updates" => "menu-check-updates",
                    "help-settings" => "menu-help-settings",
                    _ => return,
                };
                let _ = window.emit(event_name, ());
            });

            // Start file watcher
            watcher::start_watcher(app.handle());

            Ok(())
        });

    // Shared command list — debug adds set_root_via_test for native e2e tests
    macro_rules! shared_commands {
        ($($extra:path),* $(,)?) => {
            tauri::generate_handler![
                commands::fs::read_dir,
                commands::fs::read_text_file,
                commands::fs::read_binary_file,
                commands::fs::stat_file,
                commands::system::reveal_in_folder,
                commands::html::resolve_html_assets,
                commands::launch::get_launch_args,
                commands::launch::get_log_path,
                commands::launch::scan_review_files,
                commands::fs::check_path_exists,
                commands::fs::canonicalize_path,
                commands::comments::get::get_file_comments,
                commands::comments::add_comment,
                commands::comments::add_reply,
                commands::comments::edit_comment,
                commands::comments::delete_comment,
                commands::comments::compute_anchor_hash,
                commands::comments::update::update_comment,
                commands::comments::badges::get_file_badges,
                commands::comments::export::export_review_summary,
                commands::config::set_author,
                commands::config::get_author,
                commands::search::search_in_document,
                commands::html::compute_fold_regions,
                commands::search::parse_kql,
                commands::search::strip_json_comments,
                commands::onboarding::onboarding_state,
                commands::cli_shim::cli_shim_status,
                commands::cli_shim::install_cli_shim,
                commands::cli_shim::remove_cli_shim,
                commands::default_handler::default_handler_status,
                commands::default_handler::set_default_handler,
                commands::folder_context::folder_context_status,
                commands::folder_context::register_folder_context,
                commands::folder_context::unregister_folder_context,
                watcher::update_watched_files,
                commands::fs::update_tree_watched_dirs,
                commands::remote_asset::fetch_remote_asset,
                commands::word_tokens::tokenize_words,
                update::check_update,
                update::install_update,
                $($extra),*
            ]
        };
    }

    #[cfg(debug_assertions)]
    let app = app
        .invoke_handler(shared_commands![commands::launch::set_root_via_test])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    #[cfg(not(debug_assertions))]
    let app = app
        .invoke_handler(shared_commands![])
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
                let state = app_handle.state::<PendingArgsState>();
                push_pending(&state, commands::LaunchArgs { files, folders });
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.emit("args-received", ());
                }
            }
        }
        let _ = (app_handle, event);
    });
}
