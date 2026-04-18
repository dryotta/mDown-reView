# Markdown Rendering

## Requirement: GitHub Flavored Markdown rendering

The application SHALL render Markdown using the GitHub Flavored Markdown (GFM) specification, including tables, strikethrough, task lists, and autolinks.

### Scenario: Render headings
- **WHEN** a markdown file contains ATX headings (`# H1` through `###### H6`)
- **THEN** the viewer renders them as styled heading elements with appropriate visual hierarchy

### Scenario: Render GFM table
- **WHEN** a markdown file contains a GFM pipe table
- **THEN** the viewer renders it as a formatted HTML table with header row and borders

### Scenario: Render task list
- **WHEN** a markdown file contains `- [ ]` or `- [x]` list items
- **THEN** the viewer renders them as non-interactive checkboxes (unchecked and checked)

### Scenario: Render strikethrough
- **WHEN** a markdown file contains `~~text~~`
- **THEN** the viewer renders it with strikethrough styling

### Scenario: Render autolinks
- **WHEN** a markdown file contains a bare URL
- **THEN** the viewer renders it as a clickable hyperlink

---

## Requirement: Syntax-highlighted code blocks

Fenced code blocks SHALL be highlighted using `@shikijs/rehype` (same engine as `SourceViewer`) to ensure visual consistency. Supported languages include at minimum: JavaScript, TypeScript, Python, Rust, Go, Java, C, C++, C#, JSON, YAML, TOML, Bash, HTML, CSS, SQL, Markdown. Unrecognized language identifiers SHALL render as plain monospace without throwing an error.

### Scenario: Highlighted fenced code block
- **WHEN** a markdown file contains a fenced code block with a known language (e.g., ` ```python `)
- **THEN** the viewer renders it with syntax coloring matching the active theme, consistent with `SourceViewer`

### Scenario: Unlabeled or unknown language code block
- **WHEN** a markdown file contains a fenced code block without a language identifier, or with an unrecognized tag
- **THEN** the viewer renders it as plain monospace without emitting any error

### Scenario: Inline code
- **WHEN** a markdown file contains inline code (backtick-wrapped text)
- **THEN** it is rendered in a monospace font with a subtle background

---

## Requirement: Image rendering

Relative file paths SHALL be resolved relative to the document's directory. Remote URLs (http/https) SHALL also render. Images that cannot be loaded SHALL display alt text.

### Scenario: Relative image path
- **WHEN** a markdown document references an image with a relative path
- **THEN** the image is resolved relative to the document's directory and displayed inline

### Scenario: Remote image URL
- **WHEN** a markdown document references an image with an https:// URL
- **THEN** the image is loaded and displayed inline

### Scenario: Missing image
- **WHEN** a referenced image does not exist or fails to load
- **THEN** the alt text is displayed in place of the image

---

## Requirement: Links open in system browser

Hyperlinks SHALL open in the system's default browser via Tauri shell `open()`. Links SHALL NOT navigate within the application viewer.

### Scenario: Click hyperlink
- **WHEN** the user clicks a hyperlink in a rendered markdown document
- **THEN** the link opens in the system default browser and the application remains unchanged

---

## Requirement: Frontmatter display

YAML frontmatter (delimited by `---`) SHALL be detected and rendered as an expanded metadata block by default, visually separated from the document body. The user MAY collapse it.

### Scenario: Frontmatter expanded by default
- **WHEN** a markdown file has YAML frontmatter
- **THEN** the viewer shows the frontmatter key-value pairs expanded above the document body

### Scenario: Collapse frontmatter
- **WHEN** the user clicks the expanded frontmatter block header
- **THEN** the block collapses to show only the "Frontmatter" label

### Scenario: Re-expand frontmatter
- **WHEN** the frontmatter block is collapsed and the user clicks its header
- **THEN** the block expands again

---

## Requirement: Table of contents navigation

A document outline from H1–H3 headings SHALL be shown as a collapsible TOC only when the document contains three or more H1–H3 headings. Clicking an entry SHALL scroll to the corresponding heading.

### Scenario: TOC generated when document has 3 or more headings
- **WHEN** a markdown document contains three or more H1–H3 headings
- **THEN** a table of contents lists them hierarchically

### Scenario: TOC hidden for short documents
- **WHEN** a markdown document contains fewer than three H1–H3 headings
- **THEN** no table of contents is shown

### Scenario: Click TOC entry
- **WHEN** the user clicks an entry in the table of contents
- **THEN** the document scrolls to bring that heading into view

---

## Requirement: Large-file performance guard

When a markdown file exceeds 500 KB, the application SHALL display a warning banner above the rendered content. The file SHALL still be rendered.

### Scenario: Warning banner for large file
- **WHEN** the user opens a markdown file larger than 500 KB
- **THEN** a warning banner is shown: "This file is large (N KB) — rendering may be slow"
