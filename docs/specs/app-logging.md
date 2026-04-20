# App Logging

## Requirement: Log file written to OS app data directory

The application SHALL write all log events to a rotating log file at `{appDataDir}/logs/mdownreview.log`. The file SHALL rotate when it reaches 5 MB; at most 3 rotated files SHALL be retained. Log entries SHALL include ISO timestamp, log level, and message.

### Scenario: Log file created on first launch
- **WHEN** the application is launched for the first time
- **THEN** a log file exists at `{appDataDir}/logs/mdownreview.log` and contains at least one startup entry

### Scenario: Log rotation
- **WHEN** the log file reaches 5 MB
- **THEN** it is rotated to `mdownreview.log.1` and a new `mdownreview.log` is started; files beyond `.3` are deleted

---

## Requirement: Log level configurable between debug and release builds

In release builds the default log level SHALL be `info`. In debug builds the default log level SHALL be `debug`. Logs below the active level SHALL NOT be written.

### Scenario: Debug build emits debug-level entries
- **WHEN** running a debug build and a `debug!` macro is called
- **THEN** the entry appears in the log file

### Scenario: Release build suppresses debug entries
- **WHEN** running a release build and a `debug!` macro is called
- **THEN** no debug-level entry appears in the log file

---

## Requirement: Frontend log calls forwarded to Rust log channel

Log calls made from the React frontend via `logger.error/warn/info/debug` SHALL be forwarded to the Rust `tracing` channel and written to the same log file as native log events.

### Scenario: Frontend error log appears in file
- **WHEN** `logger.error("something failed")` is called in the frontend
- **THEN** an `ERROR` entry with that message appears in the log file

---

## Requirement: Log file path accessible to user

The application SHALL expose the log file path so users can locate it when reporting bugs. The path SHALL be shown in the About dialog with a "Copy path" button. The copy action SHALL use the native Tauri clipboard API (`@tauri-apps/plugin-clipboard-manager`), not `navigator.clipboard`, to ensure it works in the WebView context.

### Scenario: User can find log path
- **WHEN** the user opens the About dialog
- **THEN** the log file path is displayed and a "Copy path" button is available

### Scenario: Copy path to clipboard
- **WHEN** the user clicks "Copy path" next to the log file path
- **THEN** the full path is written to the system clipboard via the native Tauri clipboard API and a brief confirmation ("Copied!") is shown

---

## Requirement: Production log level routing

In release builds, `console.log` and `console.debug` calls from the WebView SHALL NOT be forwarded to the log file. Only `console.warn` and `console.error` output SHALL be routed to the Rust logger. In debug builds all levels SHALL be forwarded.

### Scenario: console.log suppressed in release
- **WHEN** running a release build and `console.log("some detail")` is called in the frontend
- **THEN** no entry for that message appears in the log file

### Scenario: console.error forwarded in release
- **WHEN** running a release build and `console.error("something failed")` is called
- **THEN** an `ERROR` entry for that message appears in the log file
