# Document Viewer & Tab System

## Requirement: Open file in tab

The application SHALL open a file in a new tab when the user selects it from the folder tree, when a file path is provided via CLI argument, or when the OS sends a file-open event. If the file is already open, the application SHALL activate that tab instead of opening a duplicate.

### Scenario: Open new file
- **WHEN** the user selects a file from the folder tree
- **THEN** a new tab appears with the file's name, and the file's content is displayed

### Scenario: Activate existing tab
- **WHEN** the user selects a file that is already open
- **THEN** the existing tab becomes active and no duplicate is created

### Scenario: Open file via CLI argument
- **WHEN** the app starts with a file path as a command-line argument
- **THEN** a new tab opens with that file's content

### Scenario: Open file via OS file-open event
- **WHEN** the OS sends a file-open event while the app is running
- **THEN** a new tab opens with that file's content and the window is brought to the foreground

---

## Requirement: Switch between open tabs

The application SHALL allow the user to switch between open tabs by clicking a tab. The active tab SHALL be visually distinguished from inactive tabs.

### Scenario: Switch tab
- **WHEN** the user clicks on an inactive tab
- **THEN** that tab becomes active and its content is displayed

### Scenario: Active tab indicator
- **WHEN** a tab is active
- **THEN** it is visually highlighted to distinguish it from inactive tabs

---

## Requirement: Close a tab

When the last tab is closed, the viewer SHALL display an empty state. When a non-last tab is closed, the adjacent tab SHALL become active.

### Scenario: Close tab via close button
- **WHEN** the user clicks the close button (×) on a tab
- **THEN** the tab is removed from the tab bar

### Scenario: Close last tab
- **WHEN** the user closes the only remaining open tab
- **THEN** the viewer shows an empty/welcome state

### Scenario: Close active tab with siblings
- **WHEN** the user closes the currently active tab and other tabs remain open
- **THEN** the next adjacent tab becomes active

---

## Requirement: File type detection and viewer routing

The application SHALL route files to the appropriate viewer by extension: `.md`/`.mdx` → Markdown viewer, other text files → source viewer. Binary files SHALL display a "cannot be displayed" message.

### Scenario: Open markdown file
- **WHEN** the user opens a `.md` or `.mdx` file
- **THEN** the Markdown viewer renders the content with formatted output

### Scenario: Open source code file
- **WHEN** the user opens a recognized source code file (e.g., `.ts`, `.py`, `.rs`, `.json`)
- **THEN** the source viewer displays the content with syntax highlighting

### Scenario: Open plain text file
- **WHEN** the user opens a `.txt` or unrecognized text-based file
- **THEN** the source viewer displays the raw text content

### Scenario: Open binary file
- **WHEN** the user opens a file detected as binary
- **THEN** a message is shown: "This file cannot be displayed"

---

## Requirement: Display file name in tab

Each tab SHALL display the file's base name. The full path SHALL be visible in a tooltip on hover.

### Scenario: Tab label shows base name
- **WHEN** a file is opened
- **THEN** the tab shows only the file's base name (e.g., `README.md`, not the full path)

### Scenario: Full path on hover
- **WHEN** the user hovers over a tab
- **THEN** a tooltip shows the file's full absolute path

---

## Requirement: Scroll position per tab

The application SHALL preserve the scroll position for each open tab independently. Switching tabs SHALL restore the scroll position for the activated tab.

### Scenario: Independent scroll state
- **WHEN** the user scrolls in one tab, switches to another, then switches back
- **THEN** the first tab's scroll position is restored

---

## Requirement: Keyboard shortcut to cycle tabs

- Next tab: `Ctrl+Tab` (Windows/Linux) / `Cmd+}` (macOS)
- Previous tab: `Ctrl+Shift+Tab` (Windows/Linux) / `Cmd+{` (macOS)

### Scenario: Next tab shortcut
- **WHEN** the user presses the next-tab shortcut
- **THEN** focus moves to the next tab (wrapping from last to first)

### Scenario: Previous tab shortcut
- **WHEN** the user presses the previous-tab shortcut
- **THEN** focus moves to the previous tab (wrapping from first to last)

---

## Requirement: Loading state indicator

While a file's content is being read from disk, the application SHALL display a skeleton loading placeholder.

### Scenario: Skeleton shown during load
- **WHEN** the user opens a file and the read has not yet completed
- **THEN** animated grey bars (skeleton) are shown in the viewer

### Scenario: Skeleton replaced by content
- **WHEN** the file read completes
- **THEN** the skeleton is replaced by the rendered content with no layout shift

---

## Requirement: Application color theme

The application SHALL detect the OS color scheme and apply a matching theme. The user SHALL be able to override via a toolbar toggle (cycling: System → Light → Dark). The preference SHALL persist across restarts.

### Scenario: OS dark mode applied automatically
- **WHEN** the app launches on a system with dark mode enabled
- **THEN** the app renders with a dark theme

### Scenario: User overrides to light/dark theme
- **WHEN** the user clicks the theme toggle
- **THEN** the app switches to the selected theme regardless of OS setting

### Scenario: Theme preference persisted
- **WHEN** the user sets a theme override and restarts the app
- **THEN** the previously selected theme is restored
