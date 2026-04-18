## ADDED Requirements

### Requirement: GitHub Flavored Markdown rendering
The application SHALL render Markdown content using the GitHub Flavored Markdown (GFM) specification, including all GFM extensions: tables, strikethrough, task lists, and autolinks.

#### Scenario: Render headings
- **WHEN** a markdown file contains ATX headings (`# H1` through `###### H6`)
- **THEN** the viewer renders them as styled heading elements with appropriate visual hierarchy

#### Scenario: Render GFM table
- **WHEN** a markdown file contains a GFM-style pipe table
- **THEN** the viewer renders it as a formatted HTML table with header row and borders

#### Scenario: Render task list
- **WHEN** a markdown file contains `- [ ]` or `- [x]` list items
- **THEN** the viewer renders them as checkboxes (unchecked and checked respectively), non-interactive (read-only)

#### Scenario: Render strikethrough
- **WHEN** a markdown file contains `~~text~~`
- **THEN** the viewer renders it with strikethrough styling

#### Scenario: Render autolinks
- **WHEN** a markdown file contains a bare URL (e.g., `https://example.com`)
- **THEN** the viewer renders it as a clickable hyperlink

### Requirement: Syntax-highlighted code blocks
The application SHALL render fenced code blocks with syntax highlighting using the same engine as the Source Code Viewer (`@shikijs/rehype`) to ensure visual consistency. Supported languages SHALL include at minimum: JavaScript, TypeScript, Python, Rust, Go, Java, C, C++, C#, JSON, YAML, TOML, Bash, HTML, CSS, SQL, Markdown. Unrecognized language identifiers (e.g., `mermaid`, `plaintext`) SHALL render as a plain monospace block without throwing an error.

#### Scenario: Highlighted fenced code block
- **WHEN** a markdown file contains a fenced code block with a language identifier (e.g., ` ```python `)
- **THEN** the viewer renders the block with syntax coloring matching the active theme, consistent with how the Source Code Viewer highlights the same language

#### Scenario: Unlabeled or unknown language code block
- **WHEN** a markdown file contains a fenced code block without a language identifier, or with an unrecognized language tag
- **THEN** the viewer renders it as a plain monospace block without syntax coloring and without emitting any error

#### Scenario: Inline code
- **WHEN** a markdown file contains inline code (backtick-wrapped text)
- **THEN** it is rendered in a monospace font with a subtle background, distinct from surrounding text

### Requirement: Image rendering
The application SHALL render images referenced in Markdown using relative file paths (relative to the document's directory). Remote URLs (http/https) SHALL also be rendered. Images that cannot be loaded SHALL display alt text.

#### Scenario: Relative image path
- **WHEN** a markdown document references an image with a relative path (e.g., `![alt](./diagram.png)`)
- **THEN** the image is resolved relative to the document's directory and displayed inline

#### Scenario: Remote image URL
- **WHEN** a markdown document references an image with an https:// URL
- **THEN** the image is loaded and displayed inline

#### Scenario: Missing image
- **WHEN** a referenced image file does not exist or fails to load
- **THEN** the alt text is displayed in place of the image

### Requirement: Links open in system browser
The application SHALL open hyperlinks (both in markdown body and autolinks) in the system's default browser. Links SHALL NOT navigate within the application viewer.

#### Scenario: Click hyperlink
- **WHEN** the user clicks a hyperlink in a rendered markdown document
- **THEN** the link opens in the system default browser and the application remains unchanged

### Requirement: Frontmatter display
The application SHALL detect YAML frontmatter (delimited by `---`) at the top of a markdown file and render it as an expanded metadata block by default, visually separated from the document body. The user MAY collapse it.

#### Scenario: Frontmatter expanded by default
- **WHEN** a markdown file has YAML frontmatter
- **THEN** the viewer shows the frontmatter key-value pairs expanded above the document body, so reviewers can immediately see AI-generated metadata

#### Scenario: Collapse frontmatter
- **WHEN** the user clicks the expanded frontmatter block header
- **THEN** the block collapses to show only the "Frontmatter" label

#### Scenario: Re-expand frontmatter
- **WHEN** the frontmatter block is collapsed and the user clicks its header
- **THEN** the block expands again to show the key-value pairs

### Requirement: Table of contents navigation
The application SHALL generate a document outline from headings (H1–H3) and display it as a collapsible table of contents panel within the markdown viewer only when the document contains three or more H1–H3 headings. Clicking an outline entry SHALL scroll to the corresponding heading.

#### Scenario: TOC generated when document has 3 or more headings
- **WHEN** a markdown document contains three or more H1, H2, or H3 headings
- **THEN** a table of contents panel lists them hierarchically

#### Scenario: TOC hidden for short documents
- **WHEN** a markdown document contains fewer than three H1–H3 headings
- **THEN** no table of contents panel is shown

#### Scenario: Click TOC entry
- **WHEN** the user clicks an entry in the table of contents
- **THEN** the document scrolls to bring that heading into view

### Requirement: Large-file performance guard
When a markdown file exceeds 500 KB the application SHALL display a warning banner above the rendered content. The file SHALL still be rendered; virtualized rendering for very large files is deferred to a future iteration.

#### Scenario: Warning banner for large file
- **WHEN** the user opens a markdown file larger than 500 KB
- **THEN** a warning banner is shown above the content: "This file is large (N KB) — rendering may be slow"
