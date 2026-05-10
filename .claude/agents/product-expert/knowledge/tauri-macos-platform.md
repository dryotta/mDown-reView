---
tags: [macos, product, accessibility]
source: vercel-labs/agent-skills (vendored  see LICENSE-vercel-skills.md)
---

# Tauri v2 — macOS Platform Patterns

Project-agnostic macOS-specific patterns for Tauri v2 apps. Cite a rule by its `<rule-id>`. Rule IDs are stable; the file path is local to whichever agent has bundled this knowledge.

> **Scope:** macOS-specific guidance for Tauri v2. Windows-specific rules will live in a future `windows-platform.md`. Cross-platform rules live in [`v2-patterns.md`](v2-patterns.md).

---

## Menu Bar — `mac-menu-*`

### `mac-menu-app-submenu-first`

The **first submenu** in the menu bar MUST be the macOS "application menu" (the one to the right of the Apple logo, titled with the app name). On macOS, the OS **always** interprets the first submenu as the app menu regardless of the `text` label you provide.

If you skip this and start with "File", macOS places your "File" items under the app-name menu, shifting everything else. The result looks broken.

**Pattern (Rust):**
```rust
#[cfg(target_os = "macos")]
{
    let app_menu = SubmenuBuilder::new(handle, "mdownreview")
        .about(None)           // PredefinedMenuItem::About
        .separator()
        .services()            // PredefinedMenuItem::Services
        .separator()
        .hide()                // PredefinedMenuItem::Hide
        .hide_others()         // PredefinedMenuItem::HideOthers
        .show_all()            // PredefinedMenuItem::ShowAll
        .separator()
        .quit()                // PredefinedMenuItem::Quit
        .build()?;
    menu_builder = menu_builder.item(&app_menu);
}
```

**On Windows:** Do NOT include this submenu — Windows has no app-name menu concept. Use `#[cfg(target_os = "macos")]` or runtime detection.

### `mac-menu-edit-submenu`

macOS requires an "Edit" menu with standard text-editing items (Undo, Redo, Cut, Copy, Paste, Select All) for **clipboard and text input to work correctly in webview input fields**. Without this, Cmd+C/Cmd+V may not function in `<input>` / `<textarea>` elements.

**Pattern:**
```rust
let edit_menu = SubmenuBuilder::new(handle, "Edit")
    .undo()
    .redo()
    .separator()
    .cut()
    .copy()
    .paste()
    .select_all()
    .build()?;
```

Include this on macOS unconditionally. On Windows, WebView2 handles clipboard shortcuts natively without a menu, but including the Edit menu is still recommended for discoverability.

### `mac-menu-no-quit-in-file`

On macOS, "Quit" belongs in the **app menu** (first submenu), not in "File". Users expect Cmd+Q to originate from the app-name menu. Having a duplicate "Quit" in the File menu is non-native and confusing.

On Windows, "Exit" or "Quit" at the bottom of the File menu is standard. Use conditional compilation:
```rust
#[cfg(not(target_os = "macos"))]
file_menu_builder = file_menu_builder.separator().quit();
```

### `mac-menu-settings-placement`

On macOS, "Settings…" (or "Preferences…") belongs in the **app menu** with the accelerator Cmd+Comma. On Windows, "Settings…" lives in the File menu (or a dedicated Tools menu). The accelerator `CmdOrCtrl+,` works cross-platform, but placement must differ:

```rust
#[cfg(target_os = "macos")]
// Add settings item to the app submenu
app_menu_builder = app_menu_builder.item(&settings_item);

#[cfg(not(target_os = "macos"))]
// Add settings item to the File submenu
file_menu_builder = file_menu_builder.separator().item(&settings_item);
```

### `mac-menu-window-submenu`

macOS expects a "Window" menu with at minimum: Minimize, Zoom (or Fullscreen toggle), separator, Bring All to Front. The OS appends a dynamic window list below your items automatically when the submenu is titled "Window".

---

## Window Lifecycle — `mac-lifecycle-*`

### `mac-lifecycle-close-hides`

On macOS, closing the **last window** MUST NOT quit the app. The standard Mac convention is: the app stays running (Dock icon remains), and clicking the Dock icon or Cmd+Tab reopening shows the window again. Only Cmd+Q (or Menu → Quit) exits.

**Implementation:** Handle `RunEvent::WindowEvent { event: WindowEvent::CloseRequested { api, .. }, .. }` in the `.run()` callback:
```rust
#[cfg(target_os = "macos")]
{
    api.prevent_close();
    window.hide().unwrap();
}
```

On Windows, closing the last window quits the app (the standard convention). No special handling needed.

### `mac-lifecycle-reopen-on-activate`

When the user clicks the Dock icon while the app is running but has no visible windows, macOS emits `RunEvent::Reopen { has_visible_windows: false, .. }`. The app MUST handle this by showing or recreating the main window.

```rust
tauri::RunEvent::Reopen { has_visible_windows, .. } => {
    if !has_visible_windows {
        if let Some(win) = app_handle.get_webview_window("main") {
            win.show().unwrap();
            win.set_focus().unwrap();
        }
    }
}
```

### `mac-lifecycle-quit-explicit`

The macOS app should only fully exit when:
1. User selects Quit from the app menu (Cmd+Q)
2. `PredefinedMenuItem::quit()` triggers the exit
3. Code calls `app.exit(0)` explicitly

Do NOT tie app exit to the last window closing on macOS.

---

## Keyboard & Accelerators — `mac-keys-*`

### `mac-keys-cmd-not-ctrl`

Always use `CmdOrCtrl` in Tauri accelerator strings for cross-platform shortcuts. This maps to ⌘ on macOS and Ctrl on Windows. Never hardcode `Cmd+` or `Ctrl+`.

### `mac-keys-platform-conventions`

Some keyboard conventions differ by platform. Common macOS expectations:
- **Cmd+Q** → Quit (via app menu, not File)
- **Cmd+,** → Settings/Preferences (via app menu)
- **Cmd+H** → Hide app (system-level, via app menu PredefinedMenuItem)
- **Cmd+W** → Close window/tab
- **Cmd+M** → Minimize
- **Cmd+`** → Cycle windows (system-level, no code needed)
- **Ctrl+Tab** / **Ctrl+Shift+Tab** → Next/Previous tab (differs from Windows Ctrl+Tab)

### `mac-keys-function-keys`

Function keys (F1–F12) on macOS require holding Fn by default (they trigger media/brightness otherwise). If you bind F12 to an action (e.g., DevTools), document that users may need Fn+F12 unless they change system settings.

---

## Webview (WKWebView) — `mac-webview-*`

### `mac-webview-clipboard-requires-edit-menu`

WKWebView on macOS requires a native "Edit" menu with Copy/Paste/Cut/SelectAll predefined items for clipboard keyboard shortcuts to reach webview text inputs. Without the Edit menu, Cmd+C/V/X may be swallowed by the native menu system and never reach the web content.

This is the most common "clipboard doesn't work on Mac" bug in Tauri apps.

### `mac-webview-focus-quirks`

WKWebView may lose focus more easily than WebView2 (Windows). Known scenarios:
- After a native dialog closes (file picker, alert)
- During drag-and-drop operations
- After menu interaction

Mitigation: After any native dialog completes, explicitly call `window.set_focus()` from Rust or dispatch a refocus event to the frontend.

### `mac-webview-drag-drop`

File drag-and-drop in WKWebView may not propagate `drop` events to JS listeners as reliably as WebView2. If drag-and-drop is critical:
- Test on macOS specifically
- Consider handling drops on the native (Rust) side and forwarding file paths via IPC
- Ensure `preventDefault()` is called on `dragover` events

---

## Distribution — `mac-dist-*`

### `mac-dist-universal-binary`

Ship a universal binary (`--target universal-apple-darwin`) to support both Apple Silicon (aarch64) and Intel (x86_64) Macs from a single `.app` bundle. Build with:
```bash
cargo tauri build --target universal-apple-darwin
```

### `mac-dist-code-signing`

All macOS distributions MUST be code-signed. For development/ad-hoc: use `signingIdentity: "-"` in `tauri.conf.json`. For distribution: use a Developer ID Application certificate.

Unsigned/ad-hoc-signed apps trigger Gatekeeper warnings and cannot be notarized.

### `mac-dist-notarization`

For public distribution (outside the App Store), the `.app` and `.dmg` MUST be notarized with Apple. This involves:
1. Code signing with a Developer ID certificate
2. Submitting to Apple's notary service (`xcrun notarytool submit`)
3. Stapling the ticket (`xcrun stapler staple`)

Without notarization, macOS Sequoia+ will refuse to open the app without manual security override.

### `mac-dist-entitlements`

Tauri apps using WKWebView need at minimum:
- `com.apple.security.cs.allow-jit` — required for WebKit JIT
- Network entitlements only if the app makes network requests (updater, etc.)

Do NOT include `com.apple.security.cs.disable-library-validation` unless absolutely required.

### `mac-dist-dmg-conventions`

macOS DMGs should include:
- A symbolic link to `/Applications` for drag-install
- A background image showing the install gesture
- The `.app` bundle (not a bare binary)
- Optionally a `README.txt`

---

## Titlebar & Chrome — `mac-chrome-*`

### `mac-chrome-decorations-true`

Use `decorations: true` (the default) for standard macOS traffic-light buttons and title bar. Custom titlebars (`decorations: false`) break:
- Native fullscreen (green button)
- Traffic light positioning on notched displays
- OS-level window snapping (macOS Sequoia+)

Only disable decorations if you have a compelling UX reason AND test on all Mac hardware variants.

### `mac-chrome-title-vs-filename`

macOS shows the window title in the title bar and in Mission Control / Cmd+Tab. Keep it short and informative (app name + current context). Avoid long paths — use the folder/file display name, not the full canonical path.

---

## Testing — `mac-test-*`

### `mac-test-arm-and-intel`

CI should test on both `macos-latest` (ARM) and `macos-13` (Intel) GitHub Actions runners, or use a universal binary to cover both architectures.

### `mac-test-menu-integration`

Menu-driven features (open file, close tab, toggle pane) cannot be tested through Playwright alone — Playwright controls the webview, not the native menu bar. Use:
- Keyboard shortcuts (which Playwright can send) as a proxy
- Tauri's `emit` to simulate menu events in browser-mode tests
- Native E2E tests (WebDriver/CDP on a real binary) for full menu coverage
