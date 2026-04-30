# 03 · Code Blocks

Exercises Shiki syntax highlighting across many languages, plus
edge cases (long lines, mixed indentation, very long blocks).

## Rust

```rust
use std::collections::HashMap;
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct MrsfSidecar {
    pub mrsf_version: String,
    pub document: String,
    pub comments: Vec<MrsfComment>,
}

impl MrsfSidecar {
    pub fn open<P: AsRef<Path>>(path: P) -> Result<Option<Self>, SidecarError> {
        let bytes = read_capped(path.as_ref())?;
        reject_yaml_anchors(&bytes)?;
        let sidecar: Self = serde_saphyr::from_str(&bytes)
            .map_err(|e| SidecarError::YamlParse(e.to_string()))?;
        Ok(Some(sidecar))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_through_load_sidecar() {
        let payload = MrsfSidecar {
            mrsf_version: "1.0".into(),
            document: "fidelity.md".into(),
            comments: vec![],
        };
        let yaml = serde_saphyr::to_string(&payload).expect("emit");
        let loaded: MrsfSidecar = serde_saphyr::from_str(&yaml).expect("parse");
        assert_eq!(loaded, payload);
    }
}
```

## TypeScript

```typescript
import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { useStore } from "@/store";
import { invoke } from "@/lib/tauri-commands";
import type { MrsfSidecar, MrsfComment } from "@/lib/anchor-derive";

export function useFileWatcher(activeTabPath: string | null) {
  const [generation, setGeneration] = useState(0);
  const lastSeenAt = useRef<number>(Date.now());

  useEffect(() => {
    if (!activeTabPath) return;
    const handler = (event: CustomEvent<{ path: string; kind: "content" | "review" | "deleted" }>) => {
      if (event.detail.path !== activeTabPath) return;
      lastSeenAt.current = Date.now();
      setGeneration((g) => g + 1);
    };
    window.addEventListener("mdownreview:file-changed", handler as EventListener);
    return () => window.removeEventListener("mdownreview:file-changed", handler as EventListener);
  }, [activeTabPath]);

  return { generation };
}
```

## TSX

```tsx
import { Suspense, lazy } from "react";

const MarkdownViewer = lazy(() => import("./MarkdownViewer"));

export function ViewerSwitcher({ kind, content, path }: { kind: "md" | "csv" | "json"; content: string; path: string }) {
  if (kind === "md") {
    return (
      <Suspense fallback={<div role="status">Loading…</div>}>
        <MarkdownViewer content={content} filePath={path} />
      </Suspense>
    );
  }
  return <pre>{content}</pre>;
}
```

## Python

```python
"""Generate a small valid PNG via stdlib only."""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

def write_png(path: Path, width: int, height: int, rgba_rows: list[bytes]) -> None:
    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    raw = b"".join(b"\x00" + row for row in rgba_rows)
    idat = zlib.compress(raw, 9)
    iend = b""
    path.write_bytes(sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", iend))
```

## JSON

```json
{
  "mrsf_version": "1.1",
  "document": "samples/manual-testing/01-gfm-basics.md",
  "comments": [
    {
      "id": "01HZTABCDEFGHIJKLMNOPQRSTUV",
      "author": "alice@example.com",
      "timestamp": "2026-04-30T15:00:00Z",
      "text": "Looks good — ship it.",
      "resolved": false,
      "anchor": { "kind": "line", "line": 1 },
      "responses": []
    }
  ]
}
```

## YAML

```yaml
mrsf_version: "1.1"
document: samples/manual-testing/01-gfm-basics.md
comments:
  - id: 01HZTABCDEFGHIJKLMNOPQRSTUV
    author: alice@example.com
    timestamp: "2026-04-30T15:00:00Z"
    text: |
      A multi-line comment
      using a block-literal scalar.
    resolved: false
    anchor:
      kind: word_range
      line: 7
      start_word: 2
      end_word: 5
      selected_text: "the bread-and-butter of every"
    responses: []
```

## Bash

```bash
#!/usr/bin/env bash
set -euo pipefail

# Build, test, and pack mdownreview locally.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

npm ci
(cd src-tauri && cargo test --release)
npm test
npm run test:e2e
npm run tauri:build
```

## Diff

```diff
--- a/src/components/viewers/MarkdownViewer.tsx
+++ b/src/components/viewers/MarkdownViewer.tsx
@@ -45,7 +45,7 @@ export function MarkdownViewer({ content, filePath }: Props) {
-  const [theme, setTheme] = useState<"light" | "dark">("light");
+  const [theme, setTheme] = useState<"light" | "dark">(() => detectInitialTheme());
   const remarkPlugins = useMemo(() => REMARK_PLUGINS, []);
-  const rehypePlugins = useMemo(() => buildRehypePlugins({ theme }), [theme]);
+  const rehypePlugins = useMemo(() => buildRehypePlugins({ theme, lazy: true }), [theme]);
```

## SQL

```sql
SELECT  c.id              AS comment_id,
        c.author          AS author_email,
        c.timestamp       AS created_at,
        c.text            AS body,
        c.anchor->>'kind' AS anchor_kind,
        COALESCE((c.anchor->>'line')::int, NULL) AS anchor_line
FROM    comments AS c
WHERE   c.resolved = FALSE
  AND   c.author = $1
ORDER BY c.timestamp DESC
LIMIT   100;
```

## HTML

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>mdownreview</title>
  </head>
  <body>
    <main>
      <h1>Hello, markdown.</h1>
      <p>A small <em>preview</em> document.</p>
    </main>
  </body>
</html>
```

## CSS

```css
.markdown-viewer {
  --reading-width: 720px;
  max-inline-size: var(--reading-width);
  margin-inline: auto;
  font-size: 16px;
  line-height: 1.6;
  color-scheme: light dark;
}

.markdown-viewer pre {
  position: relative;
  border-radius: 6px;
  padding: 12px 16px;
  background: light-dark(#f6f8fa, #161b22);
  overflow-x: auto;
}
```

## Plain text (no language tag)

```
+----------+         +----------+
| Renderer |  --->   | Sanitize |
+----------+         +----------+
       |                  ^
       v                  |
+----------+         +----------+
|  Shiki   |  <---   |  KaTeX   |
+----------+         +----------+
```

## Edge case — very long single line (forces horizontal scroll)

```rust
let extremely_long_assignment = "this single line is intentionally far too long to fit inside the reading column so the rendered code block must offer either a horizontal scroll bar or some kind of wrapping strategy that does not break the surrounding layout".to_string();
```

## Edge case — mixed tab/space indentation

```python
def f(x):
	if x > 0:                  # tab indent
		return x * 2           # tab + tab
	else:                      # tab
	    return -x              # tab + spaces — visually surprising
```

## Trailing checklist

- [ ] Each language gets a different highlight palette (Shiki).
- [ ] Hovering any code block reveals a "Copy" button (mermaid blocks excluded).
- [ ] Long-line code block scrolls horizontally without breaking the page.
- [ ] Mixed indentation block renders as-is (no auto-reformat).
