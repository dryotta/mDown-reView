## ADDED Requirements

### Requirement: Store slice unit tests cover state transitions
The test suite SHALL include Vitest unit tests for each Zustand store slice that verify state mutations, derived selectors, and persistence serialization without mounting any React component.

#### Scenario: Opening a folder updates workspace root
- **WHEN** `setRoot` is called with a directory path
- **THEN** `store.root` equals that path and `store.folderTree` is cleared

#### Scenario: Opening a file creates a new tab
- **WHEN** `openFile` is called with a file path that is not already open
- **THEN** a new tab entry exists in `store.tabs` with the given path and `store.activeTabId` points to it

#### Scenario: Opening an already-open file switches to its tab
- **WHEN** `openFile` is called with a path that already has an open tab
- **THEN** no duplicate tab is created and `store.activeTabId` is updated to the existing tab

#### Scenario: Closing a tab removes it and activates an adjacent tab
- **WHEN** `closeTab` is called for the active tab when other tabs exist
- **THEN** the tab is removed and `store.activeTabId` points to the nearest remaining tab

#### Scenario: Adding a comment persists to the in-memory store
- **WHEN** `addComment` is called with a filePath, lineNumber, and text
- **THEN** `store.commentsByFile[filePath]` contains a comment with matching lineNumber and text

#### Scenario: Deleting a comment removes it from the store
- **WHEN** `deleteComment` is called with a commentId
- **THEN** the comment is no longer present in any `commentsByFile` array

#### Scenario: Scroll position is saved per tab
- **WHEN** `setScrollTop` is called with a tabId and a pixel offset
- **THEN** `store.tabs[tabId].scrollTop` equals that pixel offset

### Requirement: Store persistence only serializes UI state
The Zustand `persist` middleware SHALL serialize only tab scroll positions and workspace root, not comment content (comments are persisted via sidecar files, not localStorage).

#### Scenario: Persisted state excludes comment data
- **WHEN** the store is serialized to localStorage
- **THEN** the serialized JSON does not contain any `commentsByFile` keys
