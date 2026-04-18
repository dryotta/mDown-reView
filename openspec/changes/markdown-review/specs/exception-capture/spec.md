## ADDED Requirements

### Requirement: Rust panics captured in log before process exit
The application SHALL register a custom panic hook that logs the panic message, file, and line number at `ERROR` level before the default panic behavior (process termination) occurs.

#### Scenario: Panic written to log
- **WHEN** a Rust panic occurs anywhere in the backend
- **THEN** the log file contains an `ERROR` entry with the panic message and source location before the process exits

### Requirement: Tauri command errors logged automatically
All Tauri commands that return `Result<_, String>` SHALL log the error string at `error!` level before returning the error to the frontend.

#### Scenario: Command error appears in log
- **WHEN** a Tauri command (e.g., `read_text_file`) returns an `Err`
- **THEN** an `ERROR` entry appears in the log with the command name and error message

### Requirement: Uncaught JavaScript exceptions captured
The application SHALL install a global `window.onerror` handler at the module level in `main.tsx`, before React renders, so that errors occurring during initial render and module loading are captured. The handler SHALL forward the error message and stack trace to `logger.error`.

#### Scenario: Uncaught JS error logged
- **WHEN** a JavaScript exception is thrown and not caught anywhere in the call stack
- **THEN** an `ERROR` entry appears in the log containing the error message and stack trace

#### Scenario: Error during initial render captured
- **WHEN** a JavaScript exception is thrown before React's first commit (e.g., in a module initializer or top-level import)
- **THEN** the error is captured and logged, rather than being silently swallowed

### Requirement: Unhandled promise rejections captured
The application SHALL install a global `window.onunhandledrejection` handler at the module level in `main.tsx`, before React renders, so that async errors in early initialization are captured. The handler SHALL forward the rejection reason and stack trace to `logger.error`.

#### Scenario: Unhandled rejection logged
- **WHEN** a Promise is rejected and no `.catch()` or `try/await` handles it
- **THEN** an `ERROR` entry appears in the log with the rejection reason

### Requirement: React render errors captured by ErrorBoundary
The `ErrorBoundary` component's `componentDidCatch` lifecycle SHALL call `logger.error` with the error message and React component stack whenever it catches a render-phase exception.

#### Scenario: React render error logged
- **WHEN** a React component throws during render and `ErrorBoundary` catches it
- **THEN** an `ERROR` entry appears in the log with the error message and component stack
- **THEN** the UI shows the fallback "Render error" message (existing behavior preserved)

### Requirement: Logged exceptions include context
Each captured exception log entry SHALL include: timestamp, severity (`ERROR`), source layer (`[rust]` or `[web]`), error message, and stack trace or source location where available.

#### Scenario: Log entry format
- **WHEN** any exception is captured by the logging system
- **THEN** the log entry contains timestamp, level, layer tag, and message with location
