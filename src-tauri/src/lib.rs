pub mod commands;
pub mod core;
pub mod instance_scope;
pub mod registry;
pub mod update;
pub mod watcher;

use commands::{parse_launch_args, LaunchArgs};
use tauri::menu::{Menu, MenuBuilder, MenuItem, SubmenuBuilder};
use tauri::{Emitter, Manager, Runtime};
use tauri_plugin_log::{Target, TargetKind};

// ---------------------------------------------------------------------------
// Multi-window helpers
// ---------------------------------------------------------------------------

/// Raise and focus a window (un-minimize → show → set-focus).
fn focus_window(win: &tauri::WebviewWindow) {
    let _ = win.unminimize();
    let _ = win.show();
    let _ = win.set_focus();
}

/// Extract a human-readable name from a path (last component, or full path).
fn folder_display_name(path: &std::path::Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned())
}

// ---------------------------------------------------------------------------
// Per-window menu: encode window label into each menu item ID so
// on_menu_event can route to the correct originating window.
// See rule `multiwin-per-window-menu` in docs/best-practices-common/tauri/v2-patterns.md.
// ---------------------------------------------------------------------------

/// Encode a menu item ID as `{window_label}:{action}`.
fn encode_menu_id(label: &str, action: &str) -> String {
    format!("{label}:{action}")
}

/// Parse a menu item ID back into `(window_label, action)`.
/// Returns `None` for un-prefixed global IDs (e.g. "new-window").
fn parse_menu_id(id: &str) -> Option<(&str, &str)> {
    id.split_once(':')
}

/// Build the application menu for a specific window. Each menu item ID is
/// prefixed with the window label so `on_menu_event` can identify the
/// originating window without heuristics.
fn build_window_menu<R: Runtime, M: Manager<R>>(
    handle: &M,
    label: &str,
) -> tauri::Result<Menu<R>> {
    let id = |action: &str| encode_menu_id(label, action);

    let open_file =
        MenuItem::with_id(handle, &id("open-file"), "Open File…", true, Some("CmdOrCtrl+O"))?;
    let open_folder = MenuItem::with_id(
        handle, &id("open-folder"), "Open Folder…", true, Some("CmdOrCtrl+Shift+O"),
    )?;
    let close_folder =
        MenuItem::with_id(handle, &id("close-folder"), "Close Folder", true, None::<&str>)?;
    let new_window = MenuItem::with_id(
        handle, "new-window", "New Window", true, Some("CmdOrCtrl+Shift+N"),
    )?;
    let close_tab =
        MenuItem::with_id(handle, &id("close-tab"), "Close Tab", true, Some("CmdOrCtrl+W"))?;
    let close_all_tabs = MenuItem::with_id(
        handle, &id("close-all-tabs"), "Close All Tabs", true, Some("CmdOrCtrl+Shift+W"),
    )?;
    let file_menu = SubmenuBuilder::new(handle, "File")
        .item(&open_file)
        .item(&open_folder)
        .item(&new_window)
        .item(&close_folder)
        .separator()
        .item(&close_tab)
        .item(&close_all_tabs)
        .separator()
        .quit()
        .build()?;

    let toggle_comments_pane = MenuItem::with_id(
        handle, &id("toggle-comments-pane"), "Toggle Comments Pane", true, Some("CmdOrCtrl+Shift+C"),
    )?;
    let next_tab = MenuItem::with_id(handle, &id("next-tab"), "Next Tab", true, None::<&str>)?;
    let prev_tab = MenuItem::with_id(handle, &id("prev-tab"), "Previous Tab", true, None::<&str>)?;
    let theme_system = MenuItem::with_id(handle, &id("theme-system"), "System Theme", true, None::<&str>)?;
    let theme_light = MenuItem::with_id(handle, &id("theme-light"), "Light Theme", true, None::<&str>)?;
    let theme_dark = MenuItem::with_id(handle, &id("theme-dark"), "Dark Theme", true, None::<&str>)?;
    let theme_menu = SubmenuBuilder::new(handle, "Theme")
        .item(&theme_system).item(&theme_light).item(&theme_dark).build()?;
    let view_menu = SubmenuBuilder::new(handle, "View")
        .item(&toggle_comments_pane).separator()
        .item(&next_tab).item(&prev_tab).separator()
        .item(&theme_menu).build()?;

    let win_minimize = MenuItem::with_id(handle, &id("win-minimize"), "Minimize", true, Some("CmdOrCtrl+M"))?;
    let win_bring_all = MenuItem::with_id(handle, "win-bring-all", "Bring All to Front", true, None::<&str>)?;
    let window_menu = SubmenuBuilder::new(handle, "Window")
        .item(&win_minimize).separator().item(&win_bring_all).build()?;

    let help_settings = MenuItem::with_id(handle, &id("help-settings"), "Settings…", true, None::<&str>)?;
    let about_item = MenuItem::with_id(handle, &id("about"), "About mdownreview", true, None::<&str>)?;
    let check_updates = MenuItem::with_id(handle, &id("check-updates"), "Check for Updates…", true, None::<&str>)?;
    let help_menu = SubmenuBuilder::new(handle, "Help")
        .item(&help_settings).separator().item(&about_item).separator().item(&check_updates).build()?;

    MenuBuilder::new(handle)
        .item(&file_menu).item(&view_menu).item(&window_menu).item(&help_menu)
        .build()
}

/// Create a new application window with its own per-window menu.
fn create_app_window(
    handle: &tauri::AppHandle,
    label: &str,
    title: &str,
) -> tauri::Result<tauri::WebviewWindow> {
    let menu = build_window_menu(handle, label)?;
    tauri::WebviewWindowBuilder::new(handle, label, tauri::WebviewUrl::App("index.html".into()))
        .title(title)
        .inner_size(1100.0, 750.0)
        .min_inner_size(600.0, 400.0)
        .menu(menu)
        .build()
}

#[tauri::command]
fn register_window_folder(
    window: tauri::Window,
    folder: String,
    registry: tauri::State<'_, registry::WindowRegistry>,
) -> Result<(), String> {
    let canonical = crate::core::paths::canonicalize_no_verbatim(std::path::Path::new(&folder))
        .map_err(|e| format!("invalid folder: {}", e))?;
    let display = folder_display_name(&canonical);
    registry.update_kind(window.label(), registry::WindowKind::Folder(canonical));
    let _ = window.set_title(&format!("mdownreview — {display}"));
    log::info!("[window] {} registered folder: {display}", window.label());
    Ok(())
}

#[tauri::command]
fn unregister_window_folder(
    window: tauri::Window,
    registry: tauri::State<'_, registry::WindowRegistry>,
) -> Result<(), String> {
    registry.update_kind(window.label(), registry::WindowKind::FileOnly);
    // TODO: call watcher_state.remove_window once fix/per-window-watcher-state merges
    let _ = window.set_title("mdownreview");
    log::info!("[window] {} unregistered folder", window.label());
    Ok(())
}

/// Route incoming `LaunchArgs`through the `WindowRegistry`, creating new
/// windows for unknown folders and focusing existing ones.  Shared by the
/// single-instance callback, `setup()`, and `RunEvent::Opened`.
fn route_args_through_registry(
    handle: &tauri::AppHandle,
    args: &LaunchArgs,
    ctx: &str,
) {
    let Some(reg) = handle.try_state::<registry::WindowRegistry>() else {
        return;
    };
    for folder in &args.folders {
        let canonical = std::fs::canonicalize(folder)
            .unwrap_or_else(|_| std::path::PathBuf::from(folder));
        match reg.route_folder(&canonical) {
            registry::RouteDecision::FocusExisting(label) => {
                if let Some(win) = handle.get_webview_window(&label) {
                    focus_window(&win);
                }
            }
            registry::RouteDecision::CreateFolder { path } => {
                let label = reg.next_label();
                let display = folder_display_name(&path);
                match create_app_window(handle, &label, &format!("mdownreview — {display}")) {
                    Ok(_) => {
                        reg.register(label.clone(), registry::WindowKind::Folder(path.clone()));
                        reg.push_args(&label, LaunchArgs {
                            folders: vec![path.to_string_lossy().into_owned()],
                            files: vec![],
                        });
                        log::info!("[window] {ctx}: created {label}");
                    }
                    Err(e) => log::error!("[window] {ctx}: folder window failed: {e}"),
                }
            }
            _ => {}
        }
    }
    for file in &args.files {
        let canonical = std::fs::canonicalize(file)
            .unwrap_or_else(|_| std::path::PathBuf::from(file));
        match reg.route_file(&canonical) {
            registry::RouteDecision::AddToWindow { label, files } => {
                if let Some(win) = handle.get_webview_window(&label) {
                    focus_window(&win);
                    let _ = win.emit("open-file-tab", &files);
                }
            }
            registry::RouteDecision::CreateFileOnly { files } => {
                let label = reg.next_label();
                match create_app_window(handle, &label, "mdownreview — Files") {
                    Ok(_) => {
                        reg.register(label.clone(), registry::WindowKind::FileOnly);
                        let file_strs: Vec<String> = files.iter().map(|f| f.to_string_lossy().into_owned()).collect();
                        reg.push_args(&label, LaunchArgs { files: file_strs, folders: vec![] });
                        log::info!("[window] {ctx}: created file-only window {label}");
                    }
                    Err(e) => log::error!("[window] {ctx}: file-only window failed: {e}"),
                }
            }
            registry::RouteDecision::FocusExisting(label) => {
                if let Some(win) = handle.get_webview_window(&label) {
                    focus_window(&win);
                }
            }
            _ => {}
        }
    }
}

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

    let mut builder = tauri::Builder::default()
        .plugin(log_plugin)
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init());

    // Production builds enforce single-instance; debug/test-isolated builds
    // skip it so multiple instances can coexist (AC 7 of #147).
    if !instance_scope::is_isolated() {
        builder = builder.plugin(tauri_plugin_single_instance::init(
            |app, argv, cwd| {
                let cwd_path = std::path::PathBuf::from(&cwd);
                let args = parse_launch_args(&argv[1..], &cwd_path);

                route_args_through_registry(app, &args, "single-instance");
            },
        ));
    }

    let app = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(update::PendingUpdate(std::sync::Mutex::new(None)))
        .manage(watcher::WatcherState::new(sync_tx))
        .manage(watcher::SyncRx(std::sync::Mutex::new(Some(sync_rx))))
        .manage(registry::WindowRegistry::default())
        .setup(|app| {
            // Register panic hook to log panics before process terminates
            let prev_hook = std::panic::take_hook();
            std::panic::set_hook(Box::new(move |info| {
                let msg = info.payload().downcast_ref::<&str>().copied()
                    .or_else(|| info.payload().downcast_ref::<String>().map(|s| s.as_str()))
                    .unwrap_or("unknown panic");
                let loc = info.location()
                    .map(|l| format!(" at {}:{}", l.file(), l.line()))
                    .unwrap_or_default();
                log::error!("[rust] PANIC{loc}: {msg}");
                prev_hook(info);
            }));

            // Parse CLI args: support --folder <path> and --file <path> flags
            let raw_args: Vec<String> = std::env::args().skip(1).collect();
            let cwd = std::env::current_dir().unwrap_or_default();
            let launch_args = parse_launch_args(&raw_args, &cwd);

            // Register the default "main" window in the registry
            let reg = app.state::<registry::WindowRegistry>();
            if let Some(first_folder) = launch_args.folders.first() {
                let canonical = std::fs::canonicalize(first_folder)
                    .unwrap_or_else(|_| std::path::PathBuf::from(first_folder));
                reg.register("main".to_string(), registry::WindowKind::Folder(canonical));
            } else {
                reg.register("main".to_string(), registry::WindowKind::FileOnly);
            }

            // Create additional windows for extra folders (beyond the first)
            let app_handle = app.handle().clone();
            for folder in launch_args.folders.iter().skip(1) {
                let canonical = std::fs::canonicalize(folder)
                    .unwrap_or_else(|_| std::path::PathBuf::from(folder));
                let label = reg.next_label();
                let display = folder_display_name(&canonical);
                match create_app_window(&app_handle, &label, &format!("mdownreview — {display}")) {
                    Ok(_) => {
                        reg.register(label.clone(), registry::WindowKind::Folder(canonical.clone()));
                        log::info!("[window] setup: created {label} for {}", canonical.display());
                    }
                    Err(e) => log::error!("[window] setup: window for {} failed: {e}", canonical.display()),
                }
            }

            // Push args for the main window (first folder + all files);
            // the window's React will drain via get_launch_args on boot.
            let main_args = LaunchArgs {
                files: launch_args.files,
                folders: launch_args.folders.into_iter().take(1).collect(),
            };
            reg.push_args("main", main_args);

            // ── Per-window menu for main window ──────────────────────────────
            // Main window is created by tauri.conf.json; set its menu here.
            if let Some(main_win) = app.get_webview_window("main") {
                let main_menu = build_window_menu(app, "main")?;
                main_win.set_menu(main_menu)?;
            }

            // ── Menu event routing ───────────────────────────────────────────
            // Menu item IDs encode the originating window as `{label}:{action}`
            // (per rule `multiwin-per-window-menu`). Global actions use un-prefixed IDs.
            app.on_menu_event(|app, event| {
                let id = event.id().as_ref();

                // Global actions (no window prefix)
                match id {
                    "new-window" => {
                        let reg = app.state::<registry::WindowRegistry>();
                        let label = reg.next_label();
                        match create_app_window(app, &label, "mdownreview") {
                            Ok(_) => {
                                reg.register(label.clone(), registry::WindowKind::FileOnly);
                                log::info!("[window] new-window: created {label}");
                            }
                            Err(e) => log::error!("[window] new-window failed: {e}"),
                        }
                        return;
                    }
                    "win-bring-all" => {
                        for w in app.webview_windows().values() {
                            let _ = w.unminimize();
                            let _ = w.show();
                        }
                        return;
                    }
                    _ => {}
                }

                // Window-scoped actions: parse `{label}:{action}` from the menu item ID.
                let Some((label, action)) = parse_menu_id(id) else {
                    return;
                };
                let Some(window) = app.get_webview_window(label) else {
                    log::warn!("[menu] no window for label {label:?} (action {action:?})");
                    return;
                };

                // Rust-handled actions
                if action == "win-minimize" {
                    let _ = window.minimize();
                    return;
                }

                // Forward to the correct window as a frontend Tauri event
                let event_name = match action {
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
                    "check-updates" => "menu-check-updates",
                    "help-settings" => "menu-help-settings",
                    _ => return,
                };
                let _ = window.emit(event_name, ());
            });

            // Start file watcher
            watcher::start_watcher(app.handle());

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let label = window.label().to_string();
                if let Some(reg) = window.try_state::<registry::WindowRegistry>() {
                    reg.unregister(&label);
                    log::info!(
                        "[window] Destroyed: {label} — unregistered from WindowRegistry"
                    );
                }
                if let Some(ws) = window.try_state::<watcher::WatcherState>() {
                    ws.remove_window(&label);
                    log::info!("[window] Destroyed: {label} — removed from WatcherState");
                }
            }
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
                commands::file_viewer_prefs::get_file_viewer_pref,
                commands::file_viewer_prefs::set_file_viewer_pref,

                watcher::update_watched_files,
                commands::fs::update_tree_watched_dirs,
                commands::remote_asset::fetch_remote_asset,
                commands::word_tokens::tokenize_words,
                update::check_update,
                update::install_update,
                register_window_folder,
                unregister_window_folder,
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
                let args = LaunchArgs { files, folders };
                route_args_through_registry(app_handle, &args, "macOS-open");
            }
        }
        let _ = (app_handle, event);
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn folder_display_name_uses_last_component() {
        assert_eq!(folder_display_name(Path::new("/projects/myapp")), "myapp");
    }

    #[test]
    fn folder_display_name_root_path() {
        let name = folder_display_name(Path::new("/"));
        assert!(!name.is_empty());
    }

    #[cfg(windows)]
    #[test]
    fn folder_display_name_windows_path() {
        assert_eq!(
            folder_display_name(Path::new("C:\\Users\\Dev\\Project")),
            "Project"
        );
    }

    #[test]
    fn folder_display_name_trailing_separator() {
        let name = folder_display_name(Path::new("/projects/myapp/"));
        assert_eq!(name, "myapp");
    }

    #[test]
    fn encode_menu_id_format() {
        assert_eq!(encode_menu_id("main", "open-file"), "main:open-file");
        assert_eq!(encode_menu_id("win-1", "about"), "win-1:about");
    }

    #[test]
    fn parse_menu_id_window_scoped() {
        assert_eq!(parse_menu_id("main:open-file"), Some(("main", "open-file")));
        assert_eq!(parse_menu_id("win-42:theme-dark"), Some(("win-42", "theme-dark")));
    }

    #[test]
    fn parse_menu_id_global_returns_none() {
        assert_eq!(parse_menu_id("new-window"), None);
        assert_eq!(parse_menu_id("win-bring-all"), None);
    }

    #[test]
    fn parse_menu_id_first_colon_wins() {
        assert_eq!(parse_menu_id("win-1:some:action"), Some(("win-1", "some:action")));
    }
}
