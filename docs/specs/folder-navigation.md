# Folder Navigation

## Requirement: Open folder as workspace root

The application SHALL allow the user to open a folder via "Open Folder…" dialog or a CLI folder argument. The folder tree SHALL display the folder's contents. The last opened folder SHALL be restored on next launch.

### Scenario: Open folder via menu
- **WHEN** the user selects "Open Folder…" from the toolbar
- **THEN** a native folder picker opens; upon confirmation, the folder becomes the workspace root

### Scenario: Open folder via CLI argument
- **WHEN** the app starts with a folder path as a command-line argument
- **THEN** that folder becomes the workspace root, identical to using "Open Folder…"

### Scenario: Restore last folder on launch
- **WHEN** the app launches and a previously opened folder path is stored
- **THEN** the app attempts to re-open that folder automatically

### Scenario: Previously opened folder no longer exists
- **WHEN** the app launches and the stored folder path does not exist
- **THEN** the folder tree shows an empty state with a prompt to open a folder

---

## Requirement: Display folder tree

The application SHALL display the workspace root's file system tree in a left-side pane. Folders SHALL be collapsible nodes; files SHALL be listed within their parent.

### Scenario: Tree shows root contents
- **WHEN** a workspace root is open
- **THEN** the folder tree shows the immediate children of the root directory

### Scenario: Expand a folder node
- **WHEN** the user clicks a folder node
- **THEN** the folder expands to reveal its children

### Scenario: Collapse a folder node
- **WHEN** the user clicks an expanded folder node
- **THEN** the folder collapses and its children are hidden

---

## Requirement: Highlight active file in tree

The tree entry corresponding to the currently active tab SHALL be visually highlighted.

### Scenario: Active file highlighted
- **WHEN** a file is open and active in the viewer
- **THEN** its entry in the folder tree is visually highlighted

### Scenario: Switching tabs updates highlight
- **WHEN** the user switches to a different tab
- **THEN** the highlight moves to the new active file's entry

---

## Requirement: Filter files by name

A search/filter input above the tree SHALL filter visible file entries by name (case-insensitive substring). Folders containing matching files SHALL remain visible.

### Scenario: Filter hides non-matching files
- **WHEN** the user types in the filter input
- **THEN** only files whose names contain the typed text are shown

### Scenario: Clear filter restores full tree
- **WHEN** the user clears the filter input
- **THEN** the full folder tree is restored

### Scenario: Parent folders of matches stay visible
- **WHEN** a filter is active and a nested file matches
- **THEN** the parent folder(s) remain visible and expanded

---

## Requirement: Collapse/expand all

Toolbar buttons SHALL collapse all folder nodes and expand all nodes (at most 3 levels deep to avoid unbounded filesystem calls).

### Scenario: Collapse all
- **WHEN** the user clicks "Collapse All"
- **THEN** all expanded folders collapse to show only top-level entries

### Scenario: Expand all (bounded)
- **WHEN** the user clicks "Expand All"
- **THEN** all folders up to 3 levels deep expand; folders at depth 4+ remain collapsed

---

## Requirement: Keyboard navigation in folder tree

### Scenario: Arrow Down moves focus
- **WHEN** a tree entry is focused and the user presses Arrow Down
- **THEN** focus moves to the next visible entry

### Scenario: Arrow Up moves focus
- **WHEN** a tree entry is focused and the user presses Arrow Up
- **THEN** focus moves to the previous visible entry

### Scenario: Arrow Right expands or enters folder
- **WHEN** a collapsed folder is focused and the user presses Arrow Right
- **THEN** the folder expands; if already expanded, focus moves to its first child

### Scenario: Arrow Left collapses or moves to parent
- **WHEN** an expanded folder is focused and the user presses Arrow Left
- **THEN** the folder collapses; if already collapsed, focus moves to its parent

### Scenario: Enter opens a file
- **WHEN** a file entry is focused and the user presses Enter
- **THEN** the file opens in a new tab (or activates its existing tab)

---

## Requirement: Folder pane resize

The user SHALL be able to resize the folder pane by dragging its right edge. Min width: 160px. Max width: 50% of window width.

### Scenario: Drag to resize
- **WHEN** the user drags the folder pane's right edge
- **THEN** the pane width changes within the allowed range

---

## Requirement: Collapse folder pane

The user SHALL be able to fully hide the folder pane via a toggle button or `Ctrl+B` / `Cmd+B`. When hidden, the viewer takes full available width.

### Scenario: Toggle pane off
- **WHEN** the user presses the toggle shortcut or button
- **THEN** the folder pane disappears and the viewer expands

### Scenario: Toggle pane on
- **WHEN** the folder pane is hidden and the user presses the toggle again
- **THEN** the folder pane reappears at its previous width
