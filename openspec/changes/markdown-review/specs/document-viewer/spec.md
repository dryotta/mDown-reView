## ADDED Requirements

### Requirement: Open file in tab
The application SHALL open a file in a new tab when the user selects it from the folder tree, when a file path is provided via a command-line argument, or when the OS sends a file-open event (e.g., double-click in File Explorer). If the file is already open in an existing tab, the application SHALL activate that tab instead of opening a duplicate.

#### Scenario: Open new file
- **WHEN** the user selects a file from the folder tree
- **THEN** a new tab appears in the tab bar with the file's name, and the file's content is displayed in the viewer

#### Scenario: Activate existing tab
- **WHEN** the user selects a file that is already open in a tab
- **THEN** the existing tab becomes active and no duplicate tab is created

#### Scenario: Open file via CLI argument
- **WHEN** the app starts with a file path as a command-line argument
- **THEN** a new tab opens with that file's content, identical to opening it from the folder tree

#### Scenario: Open file via OS file-open event
- **WHEN** the OS sends a file-open event (double-click or "Open With") while the app is running
- **THEN** a new tab opens with that file's content and the window is brought to the foreground

### Requirement: Switch between open tabs
The application SHALL allow the user to switch between open tabs by clicking on a tab in the tab bar. The active tab SHALL be visually distinguished from inactive tabs.

#### Scenario: Switch tab
- **WHEN** the user clicks on an inactive tab
- **THEN** that tab becomes active and its content is displayed in the viewer area

#### Scenario: Active tab indicator
- **WHEN** a tab is active
- **THEN** it is visually highlighted (e.g., bold text, underline, or background change) to distinguish it from inactive tabs

### Requirement: Close a tab
The application SHALL allow the user to close an open tab. When the last tab is closed, the viewer SHALL display an empty state. When a non-last tab is closed, the adjacent tab SHALL become active.

#### Scenario: Close tab via close button
- **WHEN** the user clicks the close button (×) on a tab
- **THEN** the tab is removed from the tab bar and its content is no longer shown

#### Scenario: Close last tab
- **WHEN** the user closes the only remaining open tab
- **THEN** the viewer area shows an empty/welcome state with no content

#### Scenario: Close active tab with siblings
- **WHEN** the user closes the currently active tab and other tabs remain open
- **THEN** the next adjacent tab becomes active

### Requirement: File type detection and viewer routing
The application SHALL detect the file type from the file extension and route it to the appropriate viewer: markdown files (`.md`, `.mdx`) to the Markdown viewer, all other text files to the source/plain-text viewer. Binary files SHALL display a message indicating they cannot be displayed.

#### Scenario: Open markdown file
- **WHEN** the user opens a file with a `.md` or `.mdx` extension
- **THEN** the Markdown viewer renders the content with formatted output

#### Scenario: Open source code file
- **WHEN** the user opens a file with a recognized source code extension (e.g., `.ts`, `.py`, `.rs`, `.json`)
- **THEN** the source viewer displays the content with syntax highlighting

#### Scenario: Open plain text file
- **WHEN** the user opens a `.txt` or unrecognized text-based file
- **THEN** the source viewer displays the raw text content

#### Scenario: Open binary file
- **WHEN** the user opens a file detected as binary (e.g., image, executable)
- **THEN** a message is shown: "This file cannot be displayed"

### Requirement: Display file name in tab
Each tab SHALL display the file's base name (not the full path). The full path SHALL be visible in a tooltip on hover.

#### Scenario: Tab label shows base name
- **WHEN** a file is opened in a tab
- **THEN** the tab label shows only the file's base name (e.g., `README.md`, not the full path)

#### Scenario: Full path on hover
- **WHEN** the user hovers over a tab
- **THEN** a tooltip shows the file's full absolute path

### Requirement: Scroll position per tab
The application SHALL preserve the scroll position for each open tab independently. Switching tabs SHALL restore the scroll position for the activated tab.

#### Scenario: Independent scroll state
- **WHEN** the user scrolls in one tab and then switches to another tab and back
- **THEN** the first tab's scroll position is restored to where it was left

### Requirement: Keyboard shortcut to cycle tabs
The application SHALL support keyboard shortcuts to navigate between open tabs (next tab: `Ctrl+Tab` on Windows/Linux, `Cmd+}` on macOS; previous tab: `Ctrl+Shift+Tab` on Windows/Linux, `Cmd+{` on macOS).

#### Scenario: Next tab shortcut
- **WHEN** the user presses the next-tab shortcut
- **THEN** focus moves to the next tab (wrapping from last to first)

#### Scenario: Previous tab shortcut
- **WHEN** the user presses the previous-tab shortcut
- **THEN** focus moves to the previous tab (wrapping from first to last)

### Requirement: Loading state indicator
While a file's content is being read from disk, the application SHALL display a skeleton loading placeholder in the viewer area so the user has visual feedback that content is on its way.

#### Scenario: Skeleton shown during load
- **WHEN** the user opens a file and the read operation has not yet completed
- **THEN** a skeleton placeholder (animated grey bars mimicking text lines) is shown in the viewer area

#### Scenario: Skeleton replaced by content
- **WHEN** the file read completes
- **THEN** the skeleton is replaced by the rendered content with no flash or layout shift

### Requirement: Application color theme
The application SHALL detect the OS color scheme (light/dark) and apply a matching visual theme. The user SHALL be able to override the theme via a toggle button in the toolbar (cycling: System → Light → Dark). The selected preference SHALL be persisted across restarts.

#### Scenario: OS dark mode applied automatically
- **WHEN** the application launches on a system with dark mode enabled
- **THEN** the app renders with a dark theme (dark background, light text, dark code highlighting)

#### Scenario: OS light mode applied automatically
- **WHEN** the application launches on a system with light mode enabled
- **THEN** the app renders with a light theme

#### Scenario: User overrides to light theme
- **WHEN** the user clicks the theme toggle to select "Light"
- **THEN** the app switches to the light theme regardless of the OS setting

#### Scenario: User overrides to dark theme
- **WHEN** the user clicks the theme toggle to select "Dark"
- **THEN** the app switches to the dark theme regardless of the OS setting

#### Scenario: Theme preference persisted
- **WHEN** the user sets a theme override and restarts the app
- **THEN** the previously selected theme is restored
