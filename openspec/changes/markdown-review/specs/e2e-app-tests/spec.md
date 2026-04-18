## ADDED Requirements

### Requirement: E2E tests cover the open-folder and file navigation flow
The Playwright suite SHALL verify that a user can open a folder and navigate to a file using the folder pane.

#### Scenario: Opening a folder populates the folder tree
- **WHEN** the user triggers "Open Folder" and selects a directory via the dialog mock
- **THEN** the folder pane lists the directory's files and subdirectories

#### Scenario: Clicking a file opens it in a new tab
- **WHEN** the user clicks a `.md` file in the folder tree
- **THEN** a new tab appears in the tab bar with the file's name and the viewer renders the file content

#### Scenario: Clicking a source file opens it in the source viewer
- **WHEN** the user clicks a `.ts` file in the folder tree
- **THEN** the source viewer renders syntax-highlighted code for that file

### Requirement: E2E tests cover tab management
The Playwright suite SHALL verify tab creation, switching, and closure.

#### Scenario: Multiple files open as separate tabs
- **WHEN** the user opens three different files sequentially
- **THEN** three tabs appear in the tab bar

#### Scenario: Clicking a tab switches the active viewer
- **WHEN** the user clicks a non-active tab
- **THEN** the viewer content changes to that tab's file

#### Scenario: Closing a tab removes it from the tab bar
- **WHEN** the user clicks the close button on a tab
- **THEN** the tab is removed and the adjacent tab becomes active

### Requirement: E2E tests cover comment add, persist, and delete
The Playwright suite SHALL verify the full review comment lifecycle.

#### Scenario: Adding a comment saves it and displays it inline
- **WHEN** the user clicks the `+` button on a paragraph, types a comment, and submits
- **THEN** the comment appears below the paragraph in a CommentThread

#### Scenario: Comments persist across page reload
- **WHEN** a comment has been added and the page is reloaded (or the file is closed and reopened)
- **THEN** the comment is still visible on the same block

#### Scenario: Deleting a comment removes it from the thread
- **WHEN** the user clicks the delete button on a comment
- **THEN** the comment is no longer visible in the thread

### Requirement: E2E tests verify scroll position is restored on tab switch
The Playwright suite SHALL verify that scroll position is preserved when switching between tabs.

#### Scenario: Scroll position restores when returning to a tab
- **WHEN** the user scrolls halfway down a file, switches to another tab, then switches back
- **THEN** the viewer is scrolled to the same position as before the tab switch
