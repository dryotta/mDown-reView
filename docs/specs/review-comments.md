# Review Comments

## Requirement: Add a block comment

The application SHALL allow the user to attach a review comment to a specific rendered block (paragraph, heading, code block, blockquote, or list) by clicking a `+` icon in the left margin that appears on hover. The comment SHALL be anchored by content hash (`blockHash`) with the nearest preceding heading slug as secondary context (`headingContext`), and the creation-time line number (`fallbackLine`) stored for display only.

### Scenario: Hover reveals comment affordance
- **WHEN** the user hovers the mouse over a rendered block
- **THEN** a comment icon appears in the left margin of that block

### Scenario: Open comment input
- **WHEN** the user clicks the comment icon on a block
- **THEN** a comment input area appears inline below that block, focused and ready for text entry

### Scenario: Submit comment
- **WHEN** the user types text and submits (via "Save" button or `Ctrl+Enter`)
- **THEN** the comment is saved, the input closes, and a margin indicator appears for that block

### Scenario: Cancel comment
- **WHEN** the user presses Escape or clicks "Cancel"
- **THEN** the input closes without saving and no comment is created

---

## Requirement: Comment anchor stability

When a reviewed document is regenerated and its blocks are reordered or moved, comments SHALL re-attach to matching blocks by content hash. A comment is orphaned only when its `blockHash` no longer exists anywhere in the document.

### Scenario: Comment survives block reorder
- **WHEN** a document is regenerated with the same paragraph content at a different position
- **THEN** the existing comment re-attaches to the matching paragraph at its new position

### Scenario: Orphaned comment flagged in panel
- **WHEN** a document is opened and a saved comment's `blockHash` no longer matches any block
- **THEN** the comment is shown in the panel with an "orphaned" visual indicator and its `fallbackLine`; no crash or data loss occurs

---

## Requirement: View existing comments

Comment indicators SHALL appear in the document margin for all blocks with unresolved comments. Clicking an indicator SHALL reveal the comment inline.

### Scenario: Margin indicator for commented blocks
- **WHEN** a document is opened that has saved comments
- **THEN** comment indicators appear in the left margin at the appropriate blocks

### Scenario: Expand comment inline
- **WHEN** the user clicks a comment indicator
- **THEN** the comment(s) for that block expand inline below the block, showing text and timestamp

### Scenario: Collapse comment
- **WHEN** the user clicks the expanded comment block
- **THEN** it collapses back to the margin indicator

---

## Requirement: Edit and delete comments

The user SHALL be able to edit or delete an existing comment. Editing replaces the text in-place; deletion removes the comment and its margin indicator.

### Scenario: Edit comment
- **WHEN** the user clicks "Edit" on an expanded comment
- **THEN** the comment text becomes editable; saving replaces the old text

### Scenario: Delete comment
- **WHEN** the user clicks "Delete" on an expanded comment
- **THEN** the comment is removed and the margin indicator disappears (if no other comments remain on that block)

---

## Requirement: Mark comment as resolved

Resolved comments SHALL be visually distinguished (dimmed with a strikethrough header) and hidden from the panel by default. A "Show resolved" toggle SHALL reveal them.

### Scenario: Resolve a comment
- **WHEN** the user clicks "Resolve"
- **THEN** the comment is marked resolved, its margin indicator changes to a muted style, it is removed from the default panel view, and the tab badge count decreases

### Scenario: Show resolved comments
- **WHEN** the user toggles "Show resolved" in the panel
- **THEN** resolved comments appear with dimmed styling below unresolved ones

### Scenario: Unresolve a comment
- **WHEN** the user clicks "Unresolve" on a resolved comment
- **THEN** the comment returns to unresolved state and the tab badge count increases

---

## Requirement: Comments panel

A right-side panel SHALL list all unresolved comments for the active document in block order. Clicking a comment SHALL scroll to the block and expand it inline.

### Scenario: Panel lists unresolved comments
- **WHEN** the comments panel is open with an active document
- **THEN** all unresolved comments are listed in block order with preview text and timestamp

### Scenario: Click comment in panel scrolls to block
- **WHEN** the user clicks a comment in the panel
- **THEN** the document scrolls to the commented block and expands the comment inline

### Scenario: Empty state
- **WHEN** the active document has no unresolved comments
- **THEN** the panel shows "No comments yet"

---

## Requirement: Toggle comments panel

The panel SHALL be toggleable via a toolbar button or `Ctrl+Shift+C` / `Cmd+Shift+C`.

### Scenario: Hide comments panel
- **WHEN** the panel is visible and the user presses the toggle
- **THEN** the panel hides and the viewer expands to fill the space

### Scenario: Show comments panel
- **WHEN** the panel is hidden and the user presses the toggle
- **THEN** the panel reappears

---

## Requirement: Comment persistence

Comments SHALL be persisted to a sidecar file (`<filename>.review.json`) in the same directory as the reviewed document. Format: `{ "version": 1, "comments": [...] }`.

Each comment object:
```json
{
  "id": "uuid",
  "blockHash": "8-char-hex",
  "headingContext": "heading-slug-or-null",
  "fallbackLine": 42,
  "text": "comment text",
  "createdAt": "ISO timestamp",
  "resolved": false
}
```

### Scenario: Comments saved with versioned envelope
- **WHEN** the user saves a comment
- **THEN** a `<filename>.review.json` is created (or updated) with `{ "version": 1, "comments": [...] }`

### Scenario: Comments loaded on open
- **WHEN** the user opens a file with an associated `.review.json` sidecar
- **THEN** the saved comments are loaded and displayed in the margin and panel

### Scenario: Legacy sidecar migration
- **WHEN** a sidecar without a `version` field is encountered
- **THEN** it is read as legacy format and migrated to `version: 1` on the next save, preserving all comment data

### Scenario: No sidecar when no comments
- **WHEN** a document is opened but no comments are added
- **THEN** no `.review.json` file is created

---

## Requirement: Comment count badge on tab

The document tab SHALL show a badge with the number of unresolved comments when unresolved comments are present.

### Scenario: Tab badge shows unresolved count
- **WHEN** a document has one or more unresolved comments
- **THEN** the tab label shows a numeric badge with the unresolved count

### Scenario: Badge disappears when all comments resolved or deleted
- **WHEN** all comments are deleted or resolved
- **THEN** the badge is removed from the tab label
