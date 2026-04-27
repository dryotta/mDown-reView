# multi-format

You open files of many different types to exercise every viewer in
mdownreview: markdown, source code, Mermaid diagrams, JSON, CSV, HTML,
images, and binary files.

Behaviour to drive:
- Use `act:"cli"` to open a mix of file types from the repo:
  - `.md` files → MarkdownViewer
  - `.ts` / `.tsx` / `.rs` files → SourceView
  - `.json` files → JSON viewer
  - `.css` files → SourceView
  - Binary files (`.png`, `.exe`) → BinaryPlaceholder / image viewer
- After opening each, screenshot + observe. Look for:
  - Blank screens / loading spinners that never resolve.
  - Syntax highlighting failures (uniform black text = MDR-SYNTAX-FAIL).
  - Console errors from unsupported file types.
- Switch between tabs of different viewer types rapidly (Ctrl+Tab).
- Resize the window while a non-markdown file is active.

You expose:
- Viewer routing bugs (wrong viewer for a file type).
- Syntax highlighting regressions (#94, #181).
- Missing file-type support causing blank screens or crashes.
- Console errors when switching between viewer types.
