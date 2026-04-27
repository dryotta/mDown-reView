# mdownreview hot-path heuristics

Project-specific failure modes derived from `docs/best-practices-project/` and
prior incident memories. Detectors here are cheap and high-yield because they
target known soft spots in the codebase.

| ID | Symptom | Detector |
|---|---|---|
| `MDR-IPC-RAW-JSON-ERROR` | Raw `{"kind":"io",…}` text appears in DOM | DOM text scan for `"kind":"` substring |
| `MDR-COMMENT-ANCHOR-LOST` | "Comment orphaned" appears after non-destructive edit | Re-anchor flow probe + DOM scan |
| `MDR-WATCHER-RACE` | Tab content blank > 500 ms after watcher event | Capture timing around watcher fires |
| `MDR-TAB-CHURN` | Console error during fast tab switch | Synthetic 5×100 ms Ctrl-Tab probe |
| `MDR-THEME-FLASH` | FOUC on theme toggle (background transitions through wrong value) | Screenshot diff at 0/50/200 ms after toggle |
| `MDR-SCROLL-JUMP` | Source view scroll position resets after add/edit comment | Capture scrollTop before/after IPC |
| `MDR-CONSOLE-ERROR` | Any unhandled `console.error` during run | Console drain |
| `MDR-SYNTAX-FAIL` | Source view tokens render uniform black (no syntax highlighting) | DOM scan for `<code>` / `<pre>` children: if all `<span>` children lack inline `style="color:..."`, flag. |
| `MDR-BLANK-VIEWER` | Viewer pane is empty (no content rendered) after file load | DOM scan for empty `main` or `.viewer-content` with zero text nodes after a wait. |
| `MDR-MENU-EVENT-MISMATCH` | Menu event fired but no handler | Listen for unhandled event payloads |

## MDR-IPC-RAW-JSON-ERROR

Tagged-enum errors from Rust commands (`#[serde(tag="kind")]`) leak to the UI
as raw JSON when the TS consumer does not exhaustively switch on `kind`. See
`src/store/index.ts:399-411` for the canonical handler that exhaustively
formats `permission_denied` but falls through to `JSON.stringify` for other
variants. Detector: scan rendered DOM text for `"kind":"` substring; flag
with anchor of the offending node.

## MDR-COMMENT-ANCHOR-LOST

Comments lose their anchor after a non-destructive edit if the 4-step
re-anchoring pipeline fails (see `docs/architecture.md` "MRSF re-anchoring").
Detector: probe the add-comment → trivial-edit → save flow, then DOM-scan for
"orphaned" / "lost anchor" copy.

## MDR-WATCHER-RACE

The file-system watcher (`src-tauri/src/watcher.rs`, 300 ms debounce) can race
with viewer mount, leaving a tab blank while contents reload. Detector:
capture screenshots 0 / 250 / 500 ms after a synthetic file-modified event;
flag if viewer DOM remains empty after 500 ms.

## MDR-TAB-CHURN

Rapid `Ctrl+Tab` switching can trigger console errors when state slices race
each other. Detector: drive 5 synthetic tab switches at 100 ms intervals;
flag any new `console.error` captured by the console drain.

## MDR-THEME-FLASH

Theme toggle should not cause a flash of un-themed content. Detector:
screenshot at 0 ms / 50 ms / 200 ms after toggle; pixel-diff middle frame
against the two book-ends; flag when the middle frame's background colour
matches neither end-state.

## MDR-SCROLL-JUMP

Source-view scrollTop resets to 0 after add/edit comment IPC if the viewer
re-mounts unnecessarily. Detector: capture `document.scrollingElement.scrollTop`
before and after the comment IPC; flag delta > 50 px without user intent.

## MDR-CONSOLE-ERROR

Any unhandled `console.error` during a run is a finding. Detector: addInitScript
patches `console.error`/`console.warn` to push into `window.__exploreUxConsole`,
which is drained at each step. (Note: IPC errors don't all surface to console;
see `e2e/native/global-setup.ts:117` for the WebView2 launch wiring that the
runner mirrors.)

## MDR-MENU-EVENT-MISMATCH

Menu events are flat kebab-case names that must be mirrored in
`src/lib/tauri-events.ts` AND `src-tauri/src/lib.rs::on_menu_event`. Detector:
capture every menu event payload during exploration; flag any payload name not
present in the known event map.

## MDR-SYNTAX-FAIL

Source view code blocks render all tokens in the same colour (typically black
or the base foreground). This indicates Shiki failed to load the language
grammar or `codeToHtml` returned unstyled output. Prior regressions: #94,
#181. Detector: after opening a `.ts` or `.rs` file, scan the rendered
`<pre><code>` block for `<span>` children; flag if zero spans have an inline
`style` attribute containing `color:`.

## MDR-BLANK-VIEWER

After opening a file, the viewer pane contains no visible text content. The
file tree shows the file is selected and a tab exists, but the center pane is
empty or shows only a loading indicator that never resolves. Detector: after
`cli` action + 2s wait, check `document.querySelector('.viewer-content, main')`
for `textContent.trim().length === 0`.
