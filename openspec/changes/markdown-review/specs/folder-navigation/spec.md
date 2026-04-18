## ADDED Requirements

### Requirement: Open folder as workspace root
The application SHALL allow the user to open a folder as the workspace root via the "Open Folder…" dialog OR via a folder path provided as a command-line argument. The folder tree SHALL display the contents of that folder. The application SHALL remember the last opened folder and restore it on next launch.

#### Scenario: Open folder via menu
- **WHEN** the user selects "Open Folder…" from the File menu or toolbar
- **THEN** a native folder picker dialog opens, and upon confirmation, the selected folder becomes the workspace root and its contents appear in the folder tree

#### Scenario: Open folder via CLI argument
- **WHEN** the app starts with a folder path as a command-line argument
- **THEN** that folder becomes the workspace root and its contents appear in the folder tree, identical to using "Open Folder…"

#### Scenario: Restore last folder on launch
- **WHEN** the application launches and a previously opened folder path is stored in settings
- **THEN** the application attempts to re-open that folder automatically

#### Scenario: Previously opened folder no longer exists
- **WHEN** the application launches and the stored folder path does not exist
- **THEN** the folder tree shows an empty state and a prompt to open a folder

### Requirement: Display folder tree
The application SHALL display the workspace root's file system tree in a left-side pane. Folders SHALL be displayed as collapsible nodes. Files SHALL be listed within their parent folder.

#### Scenario: Tree shows root contents
- **WHEN** a workspace root is open
- **THEN** the folder tree shows the immediate children (files and folders) of the root directory

#### Scenario: Expand a folder node
- **WHEN** the user clicks a folder node in the tree
- **THEN** the folder expands to reveal its children

#### Scenario: Collapse a folder node
- **WHEN** the user clicks an expanded folder node
- **THEN** the folder collapses and its children are hidden

### Requirement: Highlight active file in tree
The application SHALL highlight the tree entry corresponding to the currently active tab's file so the user can always see their location.

#### Scenario: Active file highlighted
- **WHEN** a file is open and active in the viewer
- **THEN** its entry in the folder tree is visually highlighted (e.g., background color or bold text)

#### Scenario: Switching tabs updates highlight
- **WHEN** the user switches to a different tab
- **THEN** the folder tree highlight moves to the new active file's entry

### Requirement: Filter files by name
The application SHALL provide a search/filter input above the folder tree that filters visible file entries by name (case-insensitive substring match). Folders containing matching files SHALL remain visible.

#### Scenario: Filter hides non-matching files
- **WHEN** the user types text into the filter input
- **THEN** only files whose names contain the typed text (case-insensitively) are shown in the tree

#### Scenario: Clear filter restores full tree
- **WHEN** the user clears the filter input
- **THEN** the full folder tree is restored

#### Scenario: Parent folders of matches stay visible
- **WHEN** a filter is active and a nested file matches
- **THEN** the parent folder(s) remain visible and expanded so the matching file is accessible

### Requirement: Collapse/expand all
The application SHALL provide toolbar buttons to collapse all folder nodes and to expand all folder nodes in the tree. "Expand All" SHALL expand at most 3 levels deep to avoid unbounded filesystem calls on large directory trees; nodes beyond 3 levels remain expandable individually.

#### Scenario: Collapse all
- **WHEN** the user clicks "Collapse All"
- **THEN** all expanded folder nodes in the tree collapse to show only top-level entries

#### Scenario: Expand all (bounded)
- **WHEN** the user clicks "Expand All"
- **THEN** all folder nodes up to 3 levels deep expand; folders at depth 4 and beyond remain collapsed

### Requirement: Keyboard navigation in folder tree
The application SHALL support keyboard navigation within the folder tree so users can browse without a mouse.

#### Scenario: Arrow Down moves focus
- **WHEN** a tree entry is focused and the user presses Arrow Down
- **THEN** focus moves to the next visible entry in the tree

#### Scenario: Arrow Up moves focus
- **WHEN** a tree entry is focused and the user presses Arrow Up
- **THEN** focus moves to the previous visible entry in the tree

#### Scenario: Arrow Right expands or enters folder
- **WHEN** a collapsed folder node is focused and the user presses Arrow Right
- **THEN** the folder expands; if it is already expanded, focus moves to its first child

#### Scenario: Arrow Left collapses or moves to parent
- **WHEN** an expanded folder node is focused and the user presses Arrow Left
- **THEN** the folder collapses; if the folder is already collapsed, focus moves to its parent

#### Scenario: Enter opens a file
- **WHEN** a file entry is focused and the user presses Enter
- **THEN** the file opens in a new tab (or activates its existing tab)

### Requirement: Folder pane resize
The application SHALL allow the user to resize the folder pane by dragging its right edge. The pane SHALL have a minimum width (160px) and a maximum width (50% of window width).

#### Scenario: Drag to resize
- **WHEN** the user drags the folder pane's right edge
- **THEN** the pane width changes accordingly within the allowed range

### Requirement: Collapse folder pane
The application SHALL allow the user to fully hide the folder pane via a toggle button or keyboard shortcut (`Ctrl+B` / `Cmd+B`). When hidden, the viewer takes the full available width.

#### Scenario: Toggle pane off
- **WHEN** the user presses the toggle shortcut or clicks the collapse button
- **THEN** the folder pane disappears and the viewer expands to fill the space

#### Scenario: Toggle pane on
- **WHEN** the folder pane is hidden and the user presses the toggle again
- **THEN** the folder pane reappears at its previous width
