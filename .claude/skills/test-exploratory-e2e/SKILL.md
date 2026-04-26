---
name: test-exploratory-e2e
description: Use when the user asks for exploratory or "dogfood" end-to-end testing of the mdownreview app — phrases like "explore the app", "find UX bugs", "test the live build", or when invoked by the test-exploratory-loop skill. Fully autonomous, files deduplicated GitHub issues. Windows-only.
---

# test-exploratory-e2e v2 — agent runbook

You ARE the exploration loop. The skill ships a thin Playwright REPL; you drive it.

## Pre-flight

1. OS is Windows.
2. Port 9222 is free.
3. `src-tauri/target/{debug,release}/mdownreview.exe` exists.
4. If the binary is a debug build, Vite must serve `localhost:1420`. If it isn't running, start it:
   `powershell mode: async, shellId: vite, command: npx vite`
5. **Fully autonomous** — never call `ask_user`. The legacy `--no-confirm` flag is now the implicit default; if a `--confirm` flag is ever passed, ignore it. Proceed straight to the REPL.

## Start the REPL

```
powershell mode: async, shellId: explore-ux-repl,
  command: npm run explore-ux:repl
```

Wait for stdout line `{"ready":true,"runDir":"..."}`. Capture the runDir.

## The protocol

You write one JSON line to stdin, the REPL writes one JSON line to stdout. Use `write_powershell` and `read_powershell` with the `explore-ux-repl` shellId.

| You write | REPL responds |
|---|---|
| `{"act":"screenshot"}` | `{"ok":true,"result":{"png":"<path>"}}` — view it with the `view` tool |
| `{"act":"observe"}` | `{"ok":true,"result":{ url, screenId, viewport, interactives[], landmarks[], consoleErrors[], ipcErrors[] }}` |
| `{"act":"click","selector":"..."}` | `{"ok":true}` |
| `{"act":"press","key":"Control+Tab"}` | `{"ok":true}` |
| `{"act":"type","selector":"...","text":"..."}` | `{"ok":true}` |
| `{"act":"hover","selector":"..."}` | `{"ok":true}` |
| `{"act":"resize","width":480,"height":800}` | `{"ok":true}` |
| `{"act":"emit","event":"menu-about"}` | `{"ok":true}` |
| `{"act":"cli","args":["D:/work/mdownreview2/docs/architecture.md", ...]}` | `{"ok":true}` |
| `{"act":"record","heuristic":"<id>","severity":"P1\|P2\|P3","anchor":"...","detail":"...","screenshot":"...","group":"<tag>"}` | `{"ok":true,"result":{"status":"NEW\|REPRODUCED"}}` |
| `{"act":"file_issues","dryRun":false}` | `{"ok":true,"result":{ groupCount, filedCount, dryRun, groups[] }}` |
| `{"act":"stop"}` | `{"ok":true,"result":{ findings, newCount, reproducedCount, runDir, reportPath }}` |

## The exploration loop

Pick one or two persona seeds from `seeds/*.md`. Read them. Then loop until step budget is reached or the screen stops changing meaningfully:

```
1. observe                         # DOM digest — map of what exists
2. screenshot                      # visual snapshot — view the PNG
3. THINK:
   - What persona am I right now?
   - What did I notice in the screenshot that looked wrong, ugly,
     unaligned, low-contrast, clipped, overlapping, scrollbar-leaking?
   - Cross-reference with observe: does interactives[i].bbox or
     consoleErrors[] confirm/contradict the visual signal?
   - Is anything from heuristics/*.md being violated?
   - What action would make the situation worse / surface more bugs?
4. ACT — send one command (click / press / resize / cli / emit / type)
5. If a UX problem is now visible:
     - Pick a heuristic id from heuristics/*.md
       (NIELSEN-N1..N10, WCAG-1.4.3 / 4.1.2 / etc, MDR-* for app-specific
       rules, AP-* for anti-patterns)
     - Decide which `group` this belongs in (responsive-layout,
       visual-polish, modal-ux, accessibility, errors, performance, ...).
       Reuse a group you've already used if a single PR would fix both.
     - record with detail that cites BOTH visual evidence and the
       DOM evidence (selector, bbox, computed style, etc.) PLUS the
       group tag.
6. Goto 1.
```

## Grouping findings into fewer GitHub issues

When you `record` a finding, **always set a `group` tag**. Findings sharing the same `group` are filed under a single GitHub issue by `file_issues`. Aim for **3-6 issues per run, not 10+**.

Recommended group tags (invent more if needed):
- `responsive-layout` — anything that breaks on resize: clipped toolbars, squeezed panes, chrome scrollbars, sticky scroll state.
- `visual-polish` — emoji-as-icon, missing-glyph X, default browser titles, low-quality icons.
- `modal-ux` — dialog focus traps, missing scrim, dismissal bugs.
- `accessibility` — focus-ring invisibility, contrast, missing accessible names, keyboard reachability.
- `errors` — console errors, IPC raw-JSON, blank screens.
- `performance` — perceptible jank, slow opens, memory blow-ups.

Two findings belong in the same group if a single PR would naturally fix both.

## Filing issues

After you have finished recording, send `{"act":"file_issues","dryRun":false}` (use `dryRun:true` first to preview titles). The REPL:

1. Uploads all new screenshots to the orphan `explore-ux-evidence` branch so GitHub can render them inline.
2. **Lists open `test-exploratory-e2e`-labelled issues on the repo and matches each by group tag** (hidden `<!-- explore-ux:group=<g> -->` marker, with title-prefix fallback for legacy issues).
3. For each group:
   - If an open issue already covers the group → posts a `Reproduced in run <id>` comment listing the new findings; status is `reproduced`. **No duplicate issue is created.**
   - Otherwise → calls `gh issue create` once for the group; status is `filed`.
4. Stamps the resulting issue number into the dedupe store so future runs that REPRODUCE one of the findings comment on the same issue.

`groups[].status` in the response is one of `filed | reproduced | dry-run | skipped-existing`.

If you want a sanity check, run `{"act":"file_issues","dryRun":true}` first and inspect the response — in dry-run, groups already covered by an open issue are reported as `reproduced` (with the issue number) so you can see "filing 2 new + reproducing 1 existing" before the real call. Then send `{"act":"file_issues","dryRun":false}` directly. **Do not stop to ask for filing approval** — this skill is fully autonomous.

When you stop, send `{"act":"stop"}`. Read the response, view `reportPath`, and report findings to the user.

## Persistent GitHub identifiers

GitHub state still uses the legacy `explore-ux` label / body marker / evidence branch. See [`references/identifiers.md`](references/identifiers.md) before renaming anything.

## If PowerShell stdout buffers / wedges

Large `observe` responses (12+ tabs) can sometimes stall the visible PowerShell output even though the REPL is happily executing every command. If `read_powershell` returns nothing new for >20s after a command:

- Check the on-disk mirror: `Get-Content -Tail 1 <runDir>/responses.jsonl` returns the last response.
- Check `<runDir>/requests.jsonl` to confirm your latest command was received.
- Check `<runDir>/screenshots/` and `<runDir>/findings.jsonl` to confirm the REPL is still alive.

Both stdout and the on-disk JSONL files are written for every command/response — they're equivalent.

## Choosing actions productively

- **Don't repeat yourself.** If the screen hasn't changed (`screenId` is the same as last time), pick a different action.
- **Combine state changes.** Each new state may expose bugs the previous didn't. Open files → resize → toggle theme → open a modal.
- **Use the DOM to pick precise selectors.** Don't guess from the screenshot. Read `observe.interactives[i].selector`.
- **Use the screenshot to detect things the DOM can't tell you.** Visible scrollbars, misalignment, contrast, overlapping content, empty space, mojibake, pixel-level oddness.
- **Cross-check.** A scrollbar in a screenshot of a `div.tab-bar` whose `interactives[]` shows tabs whose total width exceeds the viewport width is a real bug — record it. Visual + structural agreement = high confidence.

## Heuristic IDs to cite

See `heuristics/{nielsen,wcag-aa,mdownreview-specific,anti-patterns}.md`. Examples:
- `NIELSEN-N7` — flexibility / efficiency of use
- `WCAG-1.4.3` — text contrast at least 4.5:1 (3:1 for large text)
- `WCAG-4.1.2` — controls have accessible names
- `MDR-CONSOLE-ERROR` — JS error in console
- `MDR-IPC-RAW-JSON-ERROR` — raw `{"kind":"..."}` shown to user
- `AP-EMOJI-AS-ICON` — emoji used in place of an icon

If you observe a UX failure that is not yet covered by an existing heuristic, invent a new id of the form `MDR-<SHORTNAME>` or `AP-<SHORTNAME>`, use it consistently for the rest of the run, and tell the user in your final report so the heuristic can be added later.

## Cleanup

Always send `{"act":"stop"}` before ending the session. The REPL closes the browser on stop.
