# Design Spec — `test-exploratory-e2e` skill

**Status:** Approved (brainstorming complete, awaiting user review of this doc)
**Date:** 2026-04-25
**Owner:** mdownreview maintainers
**Inspirations:** [`bencium/bencium-marketplace/design-audit`](https://github.com/bencium/bencium-marketplace/tree/main/design-audit), [`bencium/bencium-marketplace/bencium-controlled-ux-designer`](https://github.com/bencium/bencium-marketplace/tree/main/bencium-controlled-ux-designer), [`nextlevelbuilder/ui-ux-pro-max-skill`](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill).

> Note: this doc lives at `docs/specs/skill-test-exploratory-e2e.md` (not the brainstorming-skill default `docs/superpowers/specs/...`) because `docs/superpowers/` is gitignored in this repo and the project's existing spec taxonomy is `docs/specs/`.

---

## 1. Problem

`e2e/native/` verifies *known* behaviour with scripted assertions. There is **no** automation that wanders the live app like a real user, looks at what it sees, and surfaces usability or functional drift with screenshot evidence.

The two inspiration-repo families converge on partial answers:

| Source | Pattern adopted |
|---|---|
| `design-audit` | Numbered heuristic dimensions, reduction filter, phased plan output, **strict scope discipline** ("never touches functionality"). |
| `bencium-controlled-ux-designer` | WCAG AA default, "avoid generic AI aesthetics", ask-before-deciding posture. |
| `ui-ux-pro-max-skill` | Machine-readable rule corpus indexed by family with stable rule IDs. |

None do **headed exploratory testing of a running desktop app**. That is the gap this skill fills.

## 2. Goal

A skill that drives the **already-built mdownreview Tauri app** through a real WebView2 instance (headed, visible to the developer) over CDP, explores major flows opportunistically, captures screenshot + DOM + a11y-tree + console + IPC-error evidence per step, runs a rule-based heuristic pass plus optional LLM-vision triage, and emits **deduplicated GitHub issues** with reproduction steps and attached evidence.

## 3. Non-goals (v1)

- Replacing `e2e/native/` regression tests.
- Headless mode. Runs are explicitly headed so the developer can watch.
- Editing app code. Read-only exploration; issues are filed for a separate `iterate` cycle to consume.
- macOS support. WKWebView does not expose CDP; matches the existing `e2e/native/` Windows-only constraint (`fixtures.ts:8`).
- Generic web-app exploration. Project-aware on mdownreview only.
- SaaS dependencies (Applitools etc.). Local-only, charter-compliant.

## 4. Resolved design questions

| Question | Decision |
|---|---|
| `--seed <folder\|file\|route>` mode? | **Yes** — scope a run to a PR's surface area. |
| LLM-vision triage default? | **ON** — `--no-vision` to disable. |
| Issue filing default? | **Dry-run** — `--file` to actually post. |
| Spec location? | `docs/superpowers/specs/2026-04-25-explore-ux-design.md` (this file). |
| Platform scope v1? | **Windows-only**, matches `e2e/native/`. |
| Architecture? | **Inline runner under `.claude/skills/test-exploratory-e2e/runner/`**, executed via `npx tsx`. |

## 5. Architecture

### 5.1 Directory layout

```
.claude/skills/test-exploratory-e2e/
├── SKILL.md                      ← entry: arg parsing, state machine, user-touch points
├── heuristics/
│   ├── nielsen.md                ← NIELSEN-1..10
│   ├── wcag-aa.md                ← WCAG-1.4.3, 2.1.1, 2.4.7, 4.1.2 …
│   ├── mdownreview-specific.md   ← MDR-IPC-RAW-JSON-ERROR, MDR-COMMENT-ANCHOR-LOST,
│   │                                MDR-WATCHER-RACE, MDR-TAB-CHURN, MDR-THEME-FLASH,
│   │                                MDR-SCROLL-JUMP, MDR-CONSOLE-ERROR,
│   │                                MDR-MENU-EVENT-MISMATCH
│   └── anti-patterns.md          ← AP-GENERIC-AI-AESTHETIC, AP-LIQUID-GLASS,
│                                    AP-EMOJI-AS-ICON, AP-DEAD-AFFORDANCE
├── flows/
│   ├── catalogue.md              ← seed flows (open folder, comment lifecycle, search,
│   │                                tab switch, theme toggle, settings, onboarding,
│   │                                deleted-file viewer, source-view scroll, mermaid)
│   └── flow-schema.md            ← contract: id, preconditions, steps, success-signal, recovery
├── runner/                       ← TypeScript, executed via `npx tsx`
│   ├── explore.ts                ← main loop; imports e2e/native/global-setup.ts
│   ├── capture.ts                ← screenshot + DOM hash + a11y tree + console + IPC
│   ├── analyze.ts                ← rule engine + (optional) vision sub-agent batch
│   ├── dedupe.ts                 ← reads/writes .claude/test-exploratory-e2e/known-findings.json
│   ├── report.ts                 ← writes runs/<ts>/{report.md, evidence.jsonl, screenshots/}
│   ├── issues.ts                 ← gh issue create + attach (dry-run unless --file)
│   └── *.test.ts                 ← co-located Vitest unit + integration tests
└── prompts/
    ├── triage.md                 ← system prompt for vision sub-agent
    └── issue-template.md         ← GH issue body
```

Persistent state at `.claude/test-exploratory-e2e/`:
- `known-findings.json` — dedupe DB (heuristic-id × screen-id × dom-anchor → issue#).
- `runs/<ISO-ts>/` — per-run output (report.md, evidence.jsonl, screenshots/).

### 5.2 Reuse

`runner/explore.ts` imports `e2e/native/global-setup.ts` as a library to spawn the binary with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` (existing line 117) and waits for the CDP HTTP endpoint (existing waitForCdp helper). Then connects with `chromium.connectOverCDP("http://localhost:9222")` exactly like `e2e/native/fixtures.ts:12`. Zero new launch code.

## 6. State machine (SKILL.md phases)

```
Phase 0  Pre-flight              · OS == Windows (else STOP "Windows-only in v1")
                                 · port 9222 free (else STOP)
                                 · build artefact exists at src-tauri/target/{debug,release}/
                                 · gh auth status OK (only if --file)

Phase 1  Launch & connect        · spawn binary headed via global-setup.ts
                                 · attach Playwright CDP client
                                 · inject window-error + IPC-error listeners

Phase 2  Seed                    · load flows/catalogue.md → priority queue
                                 · if --seed <path>, prepend that flow

Phase 3  Explore loop (N steps)  for each step:
                                 a. pick action: next flow step OR opportunistic
                                    (unclicked element, hover, focus, kbd-Tab, viewport resize)
                                 b. execute via Playwright
                                 c. capture: screenshot + DOM hash + a11y tree
                                            + console diff + IPC-error diff + perf
                                 d. fast rule engine on snapshot → rule_hits
                                 e. push evidence bundle to queue
                                 default N = 50, cap 200, --steps N to override

Phase 4  Triage                  · run all deterministic rule families
                                 · if vision enabled (default ON):
                                     batch ~10 bundles → 1 sub-agent call
                                     (claude-haiku-4.5, prompts/triage.md)
                                     → Findings[] {heuristic-id, severity, repro-hint}

Phase 5  Dedupe                  · key = sha256(heuristic-id|screen-id|normalised-anchor)
                                 · merge with known-findings.json
                                 · split into NEW vs REPRODUCED

Phase 6  Report & file           · always write runs/<ts>/report.md
                                 · DRY-RUN (default): print "would file N issues"
                                 · --file: gh issue create per NEW finding,
                                           gh issue comment "reproduced in run X" per REPRODUCED
                                 · update known-findings.json with new issue numbers

Phase 7  Teardown                · disconnect Playwright
                                 · kill spawned binary
                                 · summarise to user: run dir, finding counts, issue links
```

User-interaction points: Phase 0 ("yes, drive my app"; suppress with `--no-confirm`) and Phase 6 ("file these N issues?"; suppress with `--auto`). Everything else is autonomous.

### 6.1 Args

```
/explore-ux [--seed <folder|file|route>]
            [--steps N]              # default 50, cap 200
            [--no-vision]            # default vision ON
            [--file]                 # default dry-run
            [--auto]                 # skip Phase 6 confirm
            [--no-confirm]           # skip Phase 0 confirm
```

## 7. Heuristics

Every issue cites a numbered rule ID. Same posture as `AGENTS.md` review rules ("violates rule N in `docs/X.md`").

### 7.1 Nielsen 10 — `heuristics/nielsen.md`

| ID | Heuristic | Detector |
|---|---|---|
| `NIELSEN-1` | Visibility of system status | No spinner/skeleton within 250 ms after click that triggered IPC |
| `NIELSEN-2` | Match real world | Vision-only |
| `NIELSEN-3` | User control & freedom | Esc closes overlays; undo reachable for destructive actions |
| `NIELSEN-4` | Consistency & standards | Same icon across screens for same action (anchor diff) |
| `NIELSEN-5` | Error prevention | Destructive button has confirmation or undo |
| `NIELSEN-6` | Recognition over recall | Visible labels for icon-only buttons |
| `NIELSEN-7` | Flexibility & efficiency | Keyboard shortcut exists for primary action |
| `NIELSEN-8` | Aesthetic & minimal | Vision-only |
| `NIELSEN-9` | Error recovery | Error message offers next step, not raw stack |
| `NIELSEN-10` | Help & docs | Empty states have onboarding hint |

### 7.2 WCAG 2.1 AA — `heuristics/wcag-aa.md` (high-yield subset)

| ID | Rule | Detector |
|---|---|---|
| `WCAG-1.4.3` | Contrast 4.5:1 text | axe-core algorithm on computed styles |
| `WCAG-1.4.11` | Non-text contrast 3:1 | Borders, focus rings |
| `WCAG-2.1.1` | Keyboard accessible | Every interactive reachable via Tab |
| `WCAG-2.4.3` | Focus order | Tab order matches visual order |
| `WCAG-2.4.7` | Focus visible | Outline ≠ none with no replacement |
| `WCAG-2.5.8` | Target size minimum (≥ 24×24 CSS px, WCAG 2.2 AA) | Bounding-box check |
| `WCAG-4.1.2` | Name/role/value | a11y-tree node has accessible name |

### 7.3 mdownreview hot paths — `heuristics/mdownreview-specific.md` (highest value)

Distilled from prior memories and `docs/best-practices-project/`.

| ID | Symptom | Detector |
|---|---|---|
| `MDR-IPC-RAW-JSON-ERROR` | Raw `{"kind":"io",…}` text appears in DOM | DOM text scan for `"kind":"` substring (cf. `src/store/index.ts:399-411`) |
| `MDR-COMMENT-ANCHOR-LOST` | "Comment orphaned" appears after non-destructive edit | Re-anchor flow probe + DOM scan |
| `MDR-WATCHER-RACE` | Tab content blank > 500 ms after watcher event | Capture timing around watcher fires |
| `MDR-TAB-CHURN` | Console error during fast tab switch | Synthetic 5×100 ms Ctrl-Tab probe |
| `MDR-THEME-FLASH` | FOUC on theme toggle (background colour transitions through wrong value) | Screenshot diff at 0/50/200 ms after toggle |
| `MDR-SCROLL-JUMP` | Source view scroll position resets after add/edit comment | Capture scrollTop before/after IPC |
| `MDR-CONSOLE-ERROR` | Any unhandled `console.error` during run | Console drain |
| `MDR-MENU-EVENT-MISMATCH` | Menu event fired but no handler | Listen for unhandled event payloads |

### 7.4 Anti-patterns — `heuristics/anti-patterns.md`

| ID | Symptom |
|---|---|
| `AP-GENERIC-AI-AESTHETIC` | Generic SaaS blue + purple gradients (vision-flagged) |
| `AP-LIQUID-GLASS` | Backdrop-filter blur on flat-design app |
| `AP-EMOJI-AS-ICON` | DOM scan for emoji in `<button>` lacking icon component |
| `AP-DEAD-AFFORDANCE` | `cursor:pointer` element with no handler bound |

### 7.5 Severity mapping (issue label suffix)

- **P1** — any `MDR-*`, any `WCAG-*` failure on primary flow, broken keyboard navigation.
- **P2** — Nielsen violation on primary flow, `AP-*` on chrome.
- **P3** — refinement-tier (spacing/typography drift; "Phase 3" in bencium parlance).

## 8. Evidence, dedupe, issue output

### 8.1 Evidence bundle (`runs/<ts>/evidence.jsonl`)

```jsonc
{
  "step": 17,
  "ts": "2026-04-25T22:30:01.123Z",
  "flow": "comment-add",
  "action": { "kind": "click", "selector": "button[aria-label='Add comment']" },
  "screen_id": "viewer/markdown:a4f1c0d2",
  "viewport": { "w": 1280, "h": 800 },
  "screenshot": "screenshots/step-17.png",
  "dom_snapshot_sha": "ab12…",
  "a11y_tree_path": "evidence/step-17.a11y.json",
  "console_diff": [{"level":"error","text":"Failed to invoke add_comment …"}],
  "ipc_errors": [{"command":"add_comment","error":"{\"kind\":\"io\",…}"}],
  "perf": { "click_to_paint_ms": 412, "long_tasks_ms": [180] },
  "rule_hits": [
    {"id":"WCAG-1.4.3","detail":"contrast 3.1:1","anchor":".comment-meta"},
    {"id":"MDR-IPC-RAW-JSON-ERROR","detail":"raw error JSON visible","anchor":"div.error-banner"}
  ]
}
```

### 8.2 Console + IPC capture

`addInitScript` injected before navigation:
- Hooks `console.error` and `console.warn` to push into `window.__exploreUxConsole`.
- Wraps `window.__TAURI_INTERNALS__.invoke` to record `{command, error}` on rejection.

This is necessary because mdownreview's IPC errors do not always surface to console (only `formatOnboardingError` exhaustively switches on `kind`; other errors fall through to raw JSON — see `src/store/index.ts:399-411`).

### 8.3 Screen-ID fingerprinting

```
screen_id = `${route}:${sha1(sorted([landmark.role+landmark.name for landmark in a11y-tree]))[:8]}`
```

Same logical screen → same `screen_id`. A modal dialog over the viewer → distinct `screen_id`. Required so dedup keys are stable across runs.

### 8.4 Dedupe key + store

```
dedupe_key = sha256(`${heuristic_id}|${screen_id}|${normalised_anchor}`)
normalised_anchor = strip dynamic IDs/indices: button.foo[data-id=abc123] → button.foo[data-id]
```

`.claude/test-exploratory-e2e/known-findings.json`:

```jsonc
{
  "version": 1,
  "findings": {
    "<dedupe_key>": {
      "issue": 142,
      "first_seen": "2026-04-20T…",
      "last_seen": "2026-04-25T…",
      "reproductions": 3,
      "heuristic_id": "MDR-IPC-RAW-JSON-ERROR",
      "screen_id": "viewer/markdown:a4f1c0d2"
    }
  }
}
```

A finding's slot reopens when its issue is closed (skill checks `gh issue view <n> --json state` once per known key per run).

### 8.5 Issue body template

```markdown
## Heuristic
**MDR-IPC-RAW-JSON-ERROR** — Raw error JSON leaks into UI
(see `.claude/skills/test-exploratory-e2e/heuristics/mdownreview-specific.md`)

## Severity
**P1**

## Reproduction
1. Open folder with no read permission
2. Click any file in the folder
3. Observe the error banner

## Evidence
![step-17](attachments/step-17.png)

**DOM anchor:** `div.error-banner`
**Console:** `Failed to invoke read_text_file: {"kind":"io","message":"Permission denied"}`
**A11y:** banner has accessible name `'{"kind":"io","message":"Permission denied"}'`

## Suggested direction
Add a `formatFsError()` analogous to `formatOnboardingError` (`src/store/index.ts:399-411`)
that exhaustively switches on `kind` for the `read_*` commands.
Out of scope for this skill to implement.

## Run
explore-ux run id: `2026-04-25-22-30`, step 17
Reproduced 3× since 2026-04-20.
```

Labels: `test-exploratory-e2e`, `bug` or `ux`, `needs-grooming`, `severity-p{1,2,3}`.

Screenshot upload: `gh issue create --body-file body.md`, then `gh api -X POST repos/:owner/:repo/issues/:n/comments` with an inline `data:image/png;base64,…` URI. Screenshots > 1 MB are downscaled to 1280 px wide.

### 8.6 Run report (`runs/<ts>/report.md`)

Human-readable digest:
- Header: steps, flows, duration, vision on/off, dry-run vs file.
- Table of NEW findings (heuristic, severity, screen, anchor, screenshot link).
- Table of REPRODUCED findings with issue links.
- List of failed flows (flow id + last action attempted + reason).

In dry-run, also printed to stdout.

## 9. Testing

### 9.1 Layer 1 — unit tests (Vitest, co-located)

- `dedupe.test.ts` — key generation, anchor normalisation, merge with existing store, NEW/REPRODUCED/CLOSED-AND-RESEEN transitions.
- `analyze.test.ts` — rule engine: feed canned DOM/a11y snapshots, assert expected `rule_hits`. **One fixture per heuristic ID.** Most important test in the suite — guarantees rule IDs cited in issues actually fire on the patterns they claim.
- `issues.test.ts` — body-template rendering, label selection, dry-run vs file-mode branching (gh-cli mocked).
- `flow-schema.test.ts` — `flows/catalogue.md` parses into typed flow objects.

### 9.2 Layer 2 — runner integration (Vitest + mocked Playwright)

`runner/explore.integration.test.ts`. Synthetic `Page` mock returns scripted DOM/console/IPC. Asserts the loop produces expected evidence bundles in correct order, dedupe state evolves correctly across N steps.

### 9.3 Layer 3 — smoke (manual + CI-gated)

`runner/explore.smoke.test.ts`. Windows-only, gated by `EXPLORE_UX_SMOKE=1` env var (does not run in normal `npm test`). Spawns the actual binary, runs 3 steps from one canned flow, asserts:

1. `npx tsx .claude/skills/test-exploratory-e2e/runner/explore.ts --steps 3 --no-vision` exits 0.
2. `runs/<ts>/{report.md, evidence.jsonl, screenshots/}` all populated.
3. Report mentions ≥ 1 deterministic finding (e.g., contrast or accessible-name) — proves rule engine actually ran against real DOM.
4. `known-findings.json` updated with at least 1 entry, `issue: null` (dry-run).
5. No GH API calls made (verified by `gh api` log being empty for the run window).

### 9.4 Explicitly not tested

- Vision sub-agent output (non-deterministic; trusted to the prompt + dedupe layer to absorb noise).
- Real `gh issue create` API calls (gh-cli treated as a trusted external).
- Specific finding contents from real exploration (would couple test to current app state).

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Issue tracker flooded by first runs | Dry-run by default; severity floor on `--file`; dedup key from day one. |
| Vision sub-agent emits noise / hallucinated findings | All vision findings still need a heuristic-ID assignment; dedup absorbs repeats; severity floor filters P3-only vision noise. |
| CDP port 9222 collision with active dev session | Pre-flight check refuses to start if port is occupied. |
| Skill becomes flaky (changes app DOM expectations) | Layer-1 fixtures are pinned; rule engine has no live-DOM dependency in tests. |
| macOS contributors can't run the skill | Documented as Windows-only Non-Goal in v1; skill fails fast in Phase 0. |
| Re-anchoring probe (`MDR-COMMENT-ANCHOR-LOST`) writes sidecar files into a real workspace | Run uses a temp workspace seeded from `e2e/fixtures/`; never touches user data. |

## 11. Open work (post-approval)

Tracked in session SQL `todos`:

1. `scaffold-skill-dir` — create skeleton directory + file stubs.
2. `write-skill-md` — author state machine.
3. `write-heuristics` — populate four heuristic files with rule IDs and detector details.
4. `write-flow-catalogue` — seed flow list.
5. `build-runner` — explore.ts + capture.ts.
6. `build-rule-engine` — analyze.ts + per-heuristic fixtures.
7. `build-dedupe-issues` — dedupe.ts + issues.ts.
8. `smoke-run` — Windows-gated smoke test passes.

The next skill in the chain is `writing-plans`, not any implementation skill.
