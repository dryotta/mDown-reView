## ADDED Requirements

### Requirement: Open files passed as command-line arguments
The application SHALL read file paths passed as command-line arguments at startup and open each as a tab in the viewer. Paths that do not exist SHALL be silently skipped.

#### Scenario: Single file argument opens a tab
- **WHEN** the app is launched with `markdown-review path/to/file.md`
- **THEN** the file opens in a new tab and its content is displayed in the viewer

#### Scenario: Multiple file arguments open multiple tabs
- **WHEN** the app is launched with two or more file paths as arguments
- **THEN** each file opens in a separate tab; the first file's tab is active

#### Scenario: Non-existent path is skipped
- **WHEN** a path passed as an argument does not exist on the filesystem
- **THEN** no tab is created for that path and no error dialog is shown

#### Scenario: Mixed file and folder arguments
- **WHEN** the arguments include both file paths and a folder path
- **THEN** files open as tabs and the folder becomes the workspace root

### Requirement: File type association on Windows
The Windows installer (NSIS and MSI) SHALL register `.md` and `.mdx` file extensions so that double-clicking a markdown file in File Explorer launches the app and opens that file.

#### Scenario: Double-click opens file in app
- **WHEN** the user double-clicks a `.md` or `.mdx` file in Windows File Explorer after installation
- **THEN** the app launches (or an existing instance receives the path) and the file opens in a tab

#### Scenario: "Open With" lists the app
- **WHEN** the user right-clicks a `.md` file and selects "Open With"
- **THEN** "Markdown Review" appears in the list of available programs

#### Scenario: Association is per-user (no UAC prompt)
- **WHEN** the installer runs without administrator privileges
- **THEN** file associations are registered per-user (`HKCU`) and no UAC elevation prompt appears

### Requirement: File type association on macOS
The macOS app bundle SHALL declare document type handlers for `.md` and `.mdx` in `Info.plist` so that Finder registers the app and the user can open markdown files via double-click or "Open With".

#### Scenario: Double-click opens file in app (macOS)
- **WHEN** the user double-clicks a `.md` file in Finder after installation
- **THEN** the app launches (or an existing instance receives the path) and the file opens in a tab

#### Scenario: "Open With" lists the app in Finder
- **WHEN** the user right-clicks a `.md` file in Finder and selects "Open With"
- **THEN** "Markdown Review" appears in the list

### Requirement: Single-instance forwarding
When a second launch is attempted while the app is already running, the new file arguments SHALL be forwarded to the existing window rather than opening a second window.

#### Scenario: Second launch forwards args to existing window
- **WHEN** the app is running and the user opens a `.md` file from File Explorer
- **THEN** no second window opens; the existing window opens the file in a new tab and brings itself to the foreground

#### Scenario: Second launch with no args focuses existing window
- **WHEN** the app is running and launched again with no arguments
- **THEN** the existing window is brought to the foreground; no duplicate window is created
