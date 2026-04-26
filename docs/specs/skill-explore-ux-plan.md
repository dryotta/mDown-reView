# explore-ux Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a `/explore-ux` skill that drives the live mdownreview Tauri app over CDP, captures screenshot/DOM/a11y/console/IPC evidence per step, runs heuristic + (optional) vision triage, and files deduplicated GitHub issues with reproduction steps.

**Architecture:** TypeScript runner under `.claude/skills/explore-ux/runner/` invoked by SKILL.md via `npx tsx`. Reuses the spawn helper from `e2e/native/global-setup.ts` (refactored to be importable). Windows-only v1, dry-run by default, vision ON by default. Spec: `docs/specs/skill-explore-ux.md`.

**Tech Stack:** TypeScript, Playwright (`chromium.connectOverCDP`), Vitest (existing), `gh` CLI (existing), Node `child_process`. Zero new runtime dependencies.

> Plan location note: `docs/superpowers/plans/` is gitignored in this repo, so the plan lives at `docs/specs/` next to the spec.

---

## File Structure

**Created:**
- `.claude/skills/explore-ux/SKILL.md`
- `.claude/skills/explore-ux/heuristics/{nielsen,wcag-aa,mdownreview-specific,anti-patterns}.md`
- `.claude/skills/explore-ux/flows/{flow-schema,catalogue}.md`
- `.claude/skills/explore-ux/runner/{flow-schema,dedupe,analyze,capture,explore,report,issues}.ts`
- `.claude/skills/explore-ux/runner/{flow-schema,dedupe,analyze,issues,explore.integration}.test.ts`
- `.claude/skills/explore-ux/runner/explore.smoke.test.ts` (env-gated)
- `.claude/skills/explore-ux/runner/fixtures/` (per-heuristic DOM fixtures)
- `.claude/skills/explore-ux/prompts/{triage,issue-template}.md`

**Modified:**
- `e2e/native/global-setup.ts` — extract `spawnAppWithCdp()` + `waitForCdp()` to importable lib
- `package.json` — add `"explore-ux": "tsx .claude/skills/explore-ux/runner/explore.ts"` script
- `vitest.config.ts` — include `.claude/skills/explore-ux/runner/**/*.test.ts` in test glob; exclude `*.smoke.test.ts` unless `EXPLORE_UX_SMOKE=1`

**Persistent (not committed; in `.gitignore`):**
- `.claude/explore-ux/known-findings.json`
- `.claude/explore-ux/runs/`

---

## Task 1: Scaffold + gitignore

**Files:**
- Create: `.claude/skills/explore-ux/{heuristics,flows,runner,runner/fixtures,prompts}/.gitkeep`
- Modify: `.gitignore`

- [ ] **Step 1: Create directories and .gitkeep files**

```powershell
New-Item -ItemType Directory -Force -Path `
  .claude\skills\explore-ux\heuristics, `
  .claude\skills\explore-ux\flows, `
  .claude\skills\explore-ux\runner\fixtures, `
  .claude\skills\explore-ux\prompts | Out-Null
'.claude/skills/explore-ux/heuristics/.gitkeep',
'.claude/skills/explore-ux/flows/.gitkeep',
'.claude/skills/explore-ux/runner/fixtures/.gitkeep',
'.claude/skills/explore-ux/prompts/.gitkeep' |
  ForEach-Object { New-Item -ItemType File -Force -Path $_ | Out-Null }
```

- [ ] **Step 2: Add runtime artefact paths to .gitignore**

Append to `.gitignore`:

```
# explore-ux skill runtime artefacts
.claude/explore-ux/runs/
.claude/explore-ux/known-findings.json
```

- [ ] **Step 3: Commit**

```powershell
git add .claude/skills/explore-ux .gitignore
git commit -m "chore(explore-ux): scaffold skill directory" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 2: Flow schema (TypeScript contract + parser)

**Files:**
- Create: `.claude/skills/explore-ux/flows/flow-schema.md`
- Create: `.claude/skills/explore-ux/runner/flow-schema.ts`
- Create: `.claude/skills/explore-ux/runner/flow-schema.test.ts`

- [ ] **Step 1: Write flow-schema.md (the human contract)**

`flows/flow-schema.md`:

````markdown
# Flow Schema

Each flow in `catalogue.md` is a fenced YAML block under an `## <id>` heading.

```yaml
id: comment-add               # kebab-case unique id
name: Add a comment           # human title
priority: 1                   # 1 = always run, 2 = if budget, 3 = opportunistic
preconditions:
  - one file is open in a tab
steps:
  - { kind: click, selector: "button[aria-label='Add comment']" }
  - { kind: type,  selector: "textarea[name='comment']", text: "explore-ux probe" }
  - { kind: click, selector: "button[type='submit']" }
success_signal:
  selector: ".comment-thread .comment:last-child"
recovery:
  - { kind: press, key: "Escape" }
```

Step kinds: `click`, `type`, `press`, `hover`, `goto`, `wait`, `resize`.
````

- [ ] **Step 2: Write the failing test**

`runner/flow-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseFlowCatalogue } from "./flow-schema";

const SAMPLE = `# Catalogue

## comment-add

\`\`\`yaml
id: comment-add
name: Add a comment
priority: 1
preconditions:
  - one file is open
steps:
  - { kind: click, selector: "button[aria-label='Add comment']" }
success_signal:
  selector: ".comment-thread .comment:last-child"
\`\`\`

## tab-switch

\`\`\`yaml
id: tab-switch
name: Switch tabs
priority: 2
steps:
  - { kind: press, key: "Control+Tab" }
\`\`\`
`;

describe("parseFlowCatalogue", () => {
  it("extracts every flow as typed object", () => {
    const flows = parseFlowCatalogue(SAMPLE);
    expect(flows).toHaveLength(2);
    expect(flows[0]).toMatchObject({ id: "comment-add", priority: 1 });
    expect(flows[0].steps[0]).toEqual({
      kind: "click",
      selector: "button[aria-label='Add comment']",
    });
    expect(flows[1].id).toBe("tab-switch");
  });

  it("rejects unknown step kinds", () => {
    const bad = SAMPLE.replace("kind: click", "kind: explode");
    expect(() => parseFlowCatalogue(bad)).toThrow(/unknown step kind/i);
  });

  it("requires id and steps on every flow", () => {
    const noId = "## x\n```yaml\nname: bad\nsteps: []\n```\n";
    expect(() => parseFlowCatalogue(noId)).toThrow(/id/);
  });
});
```

- [ ] **Step 3: Run test, expect FAIL**

```powershell
npx vitest run .claude/skills/explore-ux/runner/flow-schema.test.ts
```

Expected: import error (file does not exist).

- [ ] **Step 4: Implement parser**

`runner/flow-schema.ts`:

```ts
import yaml from "js-yaml";

export type StepKind =
  | "click" | "type" | "press" | "hover" | "goto" | "wait" | "resize";

export interface FlowStep {
  kind: StepKind;
  selector?: string;
  text?: string;
  key?: string;
  url?: string;
  ms?: number;
  width?: number;
  height?: number;
}

export interface Flow {
  id: string;
  name: string;
  priority: 1 | 2 | 3;
  preconditions?: string[];
  steps: FlowStep[];
  success_signal?: { selector: string };
  recovery?: FlowStep[];
}

const STEP_KINDS = new Set<StepKind>([
  "click","type","press","hover","goto","wait","resize",
]);

export function parseFlowCatalogue(md: string): Flow[] {
  const flows: Flow[] = [];
  const blockRe = /```yaml\s*\n([\s\S]*?)\n```/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(md)) !== null) {
    const obj = yaml.load(m[1]) as Partial<Flow> | undefined;
    if (!obj || typeof obj !== "object") continue;
    if (!obj.id) throw new Error("flow missing id");
    if (!Array.isArray(obj.steps)) throw new Error(`flow ${obj.id} missing steps`);
    for (const s of obj.steps as FlowStep[]) {
      if (!STEP_KINDS.has(s.kind)) {
        throw new Error(`unknown step kind: ${s.kind} in flow ${obj.id}`);
      }
    }
    flows.push({
      id: obj.id,
      name: obj.name ?? obj.id,
      priority: (obj.priority ?? 2) as 1 | 2 | 3,
      preconditions: obj.preconditions,
      steps: obj.steps as FlowStep[],
      success_signal: obj.success_signal,
      recovery: obj.recovery,
    });
  }
  return flows;
}
```

- [ ] **Step 5: Run test, expect PASS**

```powershell
npx vitest run .claude/skills/explore-ux/runner/flow-schema.test.ts
```

Expected: 3 passed.

- [ ] **Step 6: Commit**

```powershell
git add .claude/skills/explore-ux/flows .claude/skills/explore-ux/runner/flow-schema.*
git commit -m "feat(explore-ux): flow schema and parser" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 3: Heuristics markdown (4 files)

**Files:** Create all four under `.claude/skills/explore-ux/heuristics/`. These are reference docs cited by issue bodies; no tests required (they're consumed by `analyze.ts` whose tests come later).

- [ ] **Step 1: Write `heuristics/nielsen.md`** (copy the table from `docs/specs/skill-explore-ux.md` §7.1; one section per rule with `## NIELSEN-N` heading and one paragraph each).

- [ ] **Step 2: Write `heuristics/wcag-aa.md`** (copy table from spec §7.2; section per rule). Note: rule is `WCAG-2.5.8` (target size minimum, AA in WCAG 2.2), not 2.5.5.

- [ ] **Step 3: Write `heuristics/mdownreview-specific.md`** (copy table from spec §7.3, with code citations to `src/store/index.ts:399-411` and `e2e/native/global-setup.ts:117`).

- [ ] **Step 4: Write `heuristics/anti-patterns.md`** (copy table from spec §7.4).

- [ ] **Step 5: Commit**

```powershell
git add .claude/skills/explore-ux/heuristics
git commit -m "feat(explore-ux): heuristic rule reference docs" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 4: Dedupe module (TDD)

**Files:**
- Create: `.claude/skills/explore-ux/runner/dedupe.ts`
- Create: `.claude/skills/explore-ux/runner/dedupe.test.ts`

- [ ] **Step 1: Write the failing test**

`runner/dedupe.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  computeDedupeKey,
  normaliseAnchor,
  loadStore,
  mergeFinding,
  saveStore,
  type Finding,
} from "./dedupe";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ux-dedupe-")); });

describe("normaliseAnchor", () => {
  it("strips dynamic id values", () => {
    expect(normaliseAnchor("button.foo[data-id=abc123]"))
      .toBe("button.foo[data-id]");
  });
  it("strips :nth-child indices", () => {
    expect(normaliseAnchor("li:nth-child(7) > span"))
      .toBe("li:nth-child > span");
  });
  it("leaves stable anchors unchanged", () => {
    expect(normaliseAnchor("button[aria-label='Add comment']"))
      .toBe("button[aria-label='Add comment']");
  });
});

describe("computeDedupeKey", () => {
  it("is stable for same inputs and changes when any field changes", () => {
    const a = computeDedupeKey("MDR-IPC-RAW-JSON-ERROR", "viewer/markdown:abcd1234", "div.error-banner");
    const b = computeDedupeKey("MDR-IPC-RAW-JSON-ERROR", "viewer/markdown:abcd1234", "div.error-banner");
    const c = computeDedupeKey("MDR-IPC-RAW-JSON-ERROR", "viewer/markdown:abcd1234", "div.other");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("mergeFinding", () => {
  it("creates NEW entry on first sight", () => {
    const store = loadStore(join(dir, "k.json"));
    const f: Finding = {
      heuristic_id: "MDR-CONSOLE-ERROR",
      screen_id: "viewer/markdown:abcd1234",
      anchor: "div.x",
      severity: "P1",
      detail: "console.error fired",
      screenshot: "screenshots/step-1.png",
    };
    const r = mergeFinding(store, f, "2026-04-25T00:00:00Z");
    expect(r.status).toBe("NEW");
    expect(store.findings[r.key].reproductions).toBe(1);
  });

  it("marks REPRODUCED on second sight and increments counter", () => {
    const store = loadStore(join(dir, "k.json"));
    const f: Finding = {
      heuristic_id: "MDR-CONSOLE-ERROR",
      screen_id: "viewer/markdown:abcd1234",
      anchor: "div.x",
      severity: "P1",
      detail: "console.error fired",
      screenshot: "screenshots/step-1.png",
    };
    mergeFinding(store, f, "2026-04-20T00:00:00Z");
    const r = mergeFinding(store, f, "2026-04-25T00:00:00Z");
    expect(r.status).toBe("REPRODUCED");
    expect(store.findings[r.key].reproductions).toBe(2);
    expect(store.findings[r.key].first_seen).toBe("2026-04-20T00:00:00Z");
    expect(store.findings[r.key].last_seen).toBe("2026-04-25T00:00:00Z");
  });

  it("round-trips through saveStore/loadStore", () => {
    const path = join(dir, "k.json");
    const store = loadStore(path);
    mergeFinding(store, {
      heuristic_id: "WCAG-1.4.3",
      screen_id: "viewer/markdown:abcd1234",
      anchor: ".x",
      severity: "P2",
      detail: "contrast 3.1:1",
      screenshot: "s.png",
    }, "2026-04-25T00:00:00Z");
    saveStore(path, store);
    expect(existsSync(path)).toBe(true);
    const reloaded = loadStore(path);
    expect(Object.keys(reloaded.findings)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL** (`module not found`).

```powershell
npx vitest run .claude/skills/explore-ux/runner/dedupe.test.ts
```

- [ ] **Step 3: Implement `runner/dedupe.ts`**

```ts
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface Finding {
  heuristic_id: string;
  screen_id: string;
  anchor: string;
  severity: "P1" | "P2" | "P3";
  detail: string;
  screenshot: string;
}

export interface StoredFinding {
  issue: number | null;
  first_seen: string;
  last_seen: string;
  reproductions: number;
  heuristic_id: string;
  screen_id: string;
}

export interface Store {
  version: 1;
  findings: Record<string, StoredFinding>;
}

export function normaliseAnchor(a: string): string {
  return a
    .replace(/\[([a-z-]+)=[^\]]+\]/gi, "[$1]")
    .replace(/:nth-child\(\d+\)/g, ":nth-child")
    .replace(/:nth-of-type\(\d+\)/g, ":nth-of-type");
}

export function computeDedupeKey(
  heuristicId: string,
  screenId: string,
  anchor: string,
): string {
  return createHash("sha256")
    .update(`${heuristicId}|${screenId}|${normaliseAnchor(anchor)}`)
    .digest("hex");
}

export function loadStore(path: string): Store {
  if (!existsSync(path)) return { version: 1, findings: {} };
  return JSON.parse(readFileSync(path, "utf8")) as Store;
}

export function saveStore(path: string, store: Store): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(store, null, 2));
}

export interface MergeResult {
  key: string;
  status: "NEW" | "REPRODUCED";
}

export function mergeFinding(
  store: Store,
  f: Finding,
  nowIso: string,
): MergeResult {
  const key = computeDedupeKey(f.heuristic_id, f.screen_id, f.anchor);
  const existing = store.findings[key];
  if (!existing) {
    store.findings[key] = {
      issue: null,
      first_seen: nowIso,
      last_seen: nowIso,
      reproductions: 1,
      heuristic_id: f.heuristic_id,
      screen_id: f.screen_id,
    };
    return { key, status: "NEW" };
  }
  existing.last_seen = nowIso;
  existing.reproductions += 1;
  return { key, status: "REPRODUCED" };
}
```

- [ ] **Step 4: Run test, expect PASS**

```powershell
npx vitest run .claude/skills/explore-ux/runner/dedupe.test.ts
```

Expected: 7 passed.

- [ ] **Step 5: Commit**

```powershell
git add .claude/skills/explore-ux/runner/dedupe.*
git commit -m "feat(explore-ux): dedupe key + persistent finding store" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 5: Rule engine (TDD with one fixture per rule)

**Files:**
- Create: `.claude/skills/explore-ux/runner/analyze.ts`
- Create: `.claude/skills/explore-ux/runner/analyze.test.ts`
- Create: `.claude/skills/explore-ux/runner/fixtures/{wcag-1.4.3-fail,wcag-1.4.3-pass,wcag-4.1.2-fail,mdr-ipc-raw-json-error,mdr-console-error,ap-emoji-as-icon}.json`

Each fixture is a serialised "snapshot" — a minimal object capturing only what the rule engine needs (DOM markup, computed-style samples, console events, IPC events, a11y nodes).

- [ ] **Step 1: Write fixtures (one per rule that has a deterministic detector)**

Example `fixtures/mdr-ipc-raw-json-error.json`:

```json
{
  "html": "<div class=\"error-banner\">{\"kind\":\"io\",\"message\":\"Permission denied\"}</div>",
  "console": [],
  "ipc_errors": [],
  "a11y_nodes": [
    { "role": "alert", "name": "{\"kind\":\"io\",\"message\":\"Permission denied\"}" }
  ],
  "computed_styles": []
}
```

Example `fixtures/wcag-1.4.3-fail.json`:

```json
{
  "html": "<span class=\"comment-meta\">2025-04-25</span>",
  "console": [],
  "ipc_errors": [],
  "a11y_nodes": [{ "role": "text", "name": "2025-04-25" }],
  "computed_styles": [
    {
      "anchor": "span.comment-meta",
      "color": "rgb(150,150,150)",
      "background": "rgb(255,255,255)",
      "fontSize": 14,
      "fontWeight": 400
    }
  ]
}
```

Create the others analogously: `wcag-1.4.3-pass.json` (color rgb(0,0,0) on white), `wcag-4.1.2-fail.json` (icon-only button with no accessible name), `mdr-console-error.json` (single console.error), `ap-emoji-as-icon.json` (`<button>📁 Open</button>` with no `<svg>` child).

- [ ] **Step 2: Write the failing test**

`runner/analyze.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runRules, type Snapshot } from "./analyze";

const FX = join(__dirname, "fixtures");
const load = (name: string): Snapshot =>
  JSON.parse(readFileSync(join(FX, `${name}.json`), "utf8"));

describe("rule engine — deterministic families", () => {
  it("MDR-IPC-RAW-JSON-ERROR fires on raw kind/message JSON in DOM", () => {
    const hits = runRules(load("mdr-ipc-raw-json-error"));
    expect(hits.map((h) => h.id)).toContain("MDR-IPC-RAW-JSON-ERROR");
  });

  it("WCAG-1.4.3 fires when contrast < 4.5:1 on body text", () => {
    const hits = runRules(load("wcag-1.4.3-fail"));
    const wcag = hits.find((h) => h.id === "WCAG-1.4.3");
    expect(wcag).toBeDefined();
    expect(wcag!.anchor).toBe("span.comment-meta");
  });

  it("WCAG-1.4.3 does NOT fire when contrast >= 4.5:1", () => {
    const hits = runRules(load("wcag-1.4.3-pass"));
    expect(hits.find((h) => h.id === "WCAG-1.4.3")).toBeUndefined();
  });

  it("WCAG-4.1.2 fires on icon-only button without accessible name", () => {
    const hits = runRules(load("wcag-4.1.2-fail"));
    expect(hits.map((h) => h.id)).toContain("WCAG-4.1.2");
  });

  it("MDR-CONSOLE-ERROR fires when any console.error is in the bundle", () => {
    const hits = runRules(load("mdr-console-error"));
    expect(hits.map((h) => h.id)).toContain("MDR-CONSOLE-ERROR");
  });

  it("AP-EMOJI-AS-ICON fires when emoji used inside button without svg", () => {
    const hits = runRules(load("ap-emoji-as-icon"));
    expect(hits.map((h) => h.id)).toContain("AP-EMOJI-AS-ICON");
  });
});
```

- [ ] **Step 3: Run test, expect FAIL**

```powershell
npx vitest run .claude/skills/explore-ux/runner/analyze.test.ts
```

- [ ] **Step 4: Implement `runner/analyze.ts`**

```ts
export interface ComputedStyle {
  anchor: string;
  color: string;        // "rgb(r,g,b)"
  background: string;
  fontSize: number;
  fontWeight: number;
}

export interface A11yNode {
  role: string;
  name: string;
  anchor?: string;
}

export interface ConsoleEvent { level: "log"|"warn"|"error"; text: string }
export interface IpcError { command: string; error: string }

export interface Snapshot {
  html: string;
  console: ConsoleEvent[];
  ipc_errors: IpcError[];
  a11y_nodes: A11yNode[];
  computed_styles: ComputedStyle[];
}

export interface RuleHit {
  id: string;
  detail: string;
  anchor: string;
}

function rgbContrast(a: string, b: string): number {
  const lum = (rgb: string): number => {
    const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(rgb);
    if (!m) return 0;
    const [r, g, bl] = [+m[1], +m[2], +m[3]].map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

type Rule = (s: Snapshot) => RuleHit[];

const ruleMdrIpcRawJson: Rule = (s) => {
  if (/"kind"\s*:\s*"/.test(s.html)) {
    const m = /<([a-z]+)[^>]*class="([^"]*)"[^>]*>[^<]*"kind"/i.exec(s.html);
    const anchor = m ? `${m[1]}.${m[2].split(/\s+/)[0]}` : "(unknown)";
    return [{
      id: "MDR-IPC-RAW-JSON-ERROR",
      detail: "raw error JSON visible in DOM",
      anchor,
    }];
  }
  return [];
};

const ruleMdrConsoleError: Rule = (s) =>
  s.console.filter((c) => c.level === "error").map((c) => ({
    id: "MDR-CONSOLE-ERROR",
    detail: c.text.slice(0, 200),
    anchor: "(console)",
  }));

const ruleWcag143: Rule = (s) =>
  s.computed_styles
    .filter((cs) => {
      const ratio = rgbContrast(cs.color, cs.background);
      const isLarge = cs.fontSize >= 18 || (cs.fontSize >= 14 && cs.fontWeight >= 700);
      return ratio < (isLarge ? 3 : 4.5);
    })
    .map((cs) => ({
      id: "WCAG-1.4.3",
      detail: `contrast ${rgbContrast(cs.color, cs.background).toFixed(2)}:1`,
      anchor: cs.anchor,
    }));

const ruleWcag412: Rule = (s) =>
  s.a11y_nodes
    .filter((n) => /button|link/.test(n.role) && (!n.name || n.name.trim() === ""))
    .map((n) => ({
      id: "WCAG-4.1.2",
      detail: `${n.role} has no accessible name`,
      anchor: n.anchor ?? `(role=${n.role})`,
    }));

const ruleApEmojiAsIcon: Rule = (s) => {
  // Buttons containing emoji but no <svg> or <img>
  const buttonRe = /<button\b[^>]*>([\s\S]*?)<\/button>/gi;
  const emojiRe = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  const hits: RuleHit[] = [];
  let m: RegExpExecArray | null;
  while ((m = buttonRe.exec(s.html)) !== null) {
    if (emojiRe.test(m[1]) && !/<(svg|img)\b/i.test(m[1])) {
      hits.push({
        id: "AP-EMOJI-AS-ICON",
        detail: "button uses emoji as icon",
        anchor: "button",
      });
    }
  }
  return hits;
};

const RULES: Rule[] = [
  ruleMdrIpcRawJson,
  ruleMdrConsoleError,
  ruleWcag143,
  ruleWcag412,
  ruleApEmojiAsIcon,
];

export function runRules(snapshot: Snapshot): RuleHit[] {
  return RULES.flatMap((r) => r(snapshot));
}
```

- [ ] **Step 5: Run test, expect PASS**

```powershell
npx vitest run .claude/skills/explore-ux/runner/analyze.test.ts
```

Expected: 6 passed.

- [ ] **Step 6: Commit**

```powershell
git add .claude/skills/explore-ux/runner/analyze.* .claude/skills/explore-ux/runner/fixtures
git commit -m "feat(explore-ux): rule engine with per-heuristic fixtures" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 6: Refactor global-setup.ts to expose spawn helper

**Files:**
- Modify: `e2e/native/global-setup.ts` — extract `spawnAppWithCdp()` and `waitForCdp()` as named exports without changing existing default-export behaviour.

- [ ] **Step 1: Read current file**

```powershell
Get-Content e2e/native/global-setup.ts | Select-Object -First 200
```

- [ ] **Step 2: Add named exports**

At the bottom of `e2e/native/global-setup.ts`, after the existing `globalSetup` export, append:

```ts
/**
 * Library export for non-Playwright callers (e.g., explore-ux skill).
 * Spawns the binary with CDP enabled and resolves once the CDP HTTP endpoint
 * responds. Caller is responsible for killing `appProc` on teardown.
 *
 * Throws on non-Windows (matches `e2e/native/fixtures.ts:8` behaviour).
 */
export async function spawnAppWithCdp(opts?: {
  binaryPath?: string;
  cdpPort?: number;
  timeoutMs?: number;
}): Promise<{ appProc: ChildProcess; cdpPort: number }> {
  if (process.platform !== "win32") {
    throw new Error("spawnAppWithCdp requires Windows (WebView2 + CDP)");
  }
  const cdpPort = opts?.cdpPort ?? CDP_PORT;
  const binaryPath = opts?.binaryPath ?? BINARY_PATH;
  if (!fs.existsSync(binaryPath)) {
    throw new Error(`Binary not found at ${binaryPath}. Build first: 'cd src-tauri && cargo build'.`);
  }
  const appProc = spawn(binaryPath, [], {
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${cdpPort}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });
  let alive = true;
  appProc.once("exit", () => { alive = false; });
  await waitForCdp(cdpPort, opts?.timeoutMs ?? 30_000, () => alive);
  return { appProc, cdpPort };
}

export { waitForCdp };
```

- [ ] **Step 3: Verify existing native E2E still parses**

```powershell
npx tsc --noEmit -p e2e/native/tsconfig.json
# If no native tsconfig exists, fall back to root tsc:
npx tsc --noEmit
```

Expected: no new errors related to `global-setup.ts`.

- [ ] **Step 4: Commit**

```powershell
git add e2e/native/global-setup.ts
git commit -m "refactor(e2e/native): expose spawnAppWithCdp helper for explore-ux" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 7: Capture module (init-script + screenshot + a11y)

**Files:**
- Create: `.claude/skills/explore-ux/runner/capture.ts`

This module is mostly Playwright glue — its real verification happens inside the integration test (Task 9). No standalone unit test.

- [ ] **Step 1: Write `runner/capture.ts`**

```ts
import { createHash } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Page } from "@playwright/test";
import type { Snapshot } from "./analyze";

declare global {
  interface Window {
    __exploreUxConsole?: { level: string; text: string }[];
    __exploreUxIpcErrors?: { command: string; error: string }[];
  }
}

/**
 * Inject console + IPC drains BEFORE navigation.
 * Required because mdownreview's IPC errors don't all surface to console
 * (cf. src/store/index.ts:399-411 — only formatOnboardingError handles 'kind').
 */
export async function attachDrains(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__exploreUxConsole = [];
    window.__exploreUxIpcErrors = [];
    for (const level of ["log", "warn", "error"] as const) {
      const orig = console[level].bind(console);
      console[level] = (...args: unknown[]) => {
        window.__exploreUxConsole!.push({
          level,
          text: args.map((a) => typeof a === "string" ? a : JSON.stringify(a)).join(" "),
        });
        orig(...(args as []));
      };
    }
    const tauri = (window as unknown as {
      __TAURI_INTERNALS__?: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
    }).__TAURI_INTERNALS__;
    if (tauri) {
      const origInvoke = tauri.invoke;
      tauri.invoke = async (cmd: string, args?: unknown) => {
        try {
          return await origInvoke(cmd, args);
        } catch (err) {
          window.__exploreUxIpcErrors!.push({
            command: cmd,
            error: typeof err === "string" ? err : JSON.stringify(err),
          });
          throw err;
        }
      };
    }
  });
}

export interface CaptureBundle {
  step: number;
  ts: string;
  screenshot: string;
  domSnapshotSha: string;
  snapshot: Snapshot;
  screenId: string;
}

export async function capture(
  page: Page,
  step: number,
  runDir: string,
): Promise<CaptureBundle> {
  const ts = new Date().toISOString();
  const screenshotRel = `screenshots/step-${step}.png`;
  const screenshotAbs = join(runDir, screenshotRel);
  mkdirSync(dirname(screenshotAbs), { recursive: true });
  await page.screenshot({ path: screenshotAbs, fullPage: false });

  const html = await page.content();
  const domSnapshotSha = createHash("sha1").update(html).digest("hex");

  const drained = await page.evaluate(() => {
    const c = window.__exploreUxConsole ?? [];
    const i = window.__exploreUxIpcErrors ?? [];
    window.__exploreUxConsole = [];
    window.__exploreUxIpcErrors = [];
    return { c, i };
  });

  // Sample computed styles for every visible text-bearing element.
  const computed_styles = await page.evaluate(() => {
    const out: { anchor: string; color: string; background: string; fontSize: number; fontWeight: number }[] = [];
    const seen = new Set<Element>();
    document.querySelectorAll("*").forEach((el) => {
      if (seen.has(el)) return;
      const text = el.textContent?.trim() ?? "";
      if (!text || el.children.length > 0) return;
      const cs = getComputedStyle(el);
      out.push({
        anchor: `${el.tagName.toLowerCase()}${el.className ? "." + (el.className as string).split(/\s+/)[0] : ""}`,
        color: cs.color,
        background: cs.backgroundColor === "rgba(0, 0, 0, 0)" ? "rgb(255,255,255)" : cs.backgroundColor,
        fontSize: parseFloat(cs.fontSize),
        fontWeight: parseInt(cs.fontWeight, 10) || 400,
      });
      seen.add(el);
    });
    return out;
  });

  // Accessibility snapshot via Playwright's a11y API.
  const a11y = await page.accessibility.snapshot();
  const a11y_nodes: { role: string; name: string }[] = [];
  const walk = (n: { role?: string; name?: string; children?: unknown[] } | null) => {
    if (!n) return;
    if (n.role) a11y_nodes.push({ role: n.role, name: n.name ?? "" });
    (n.children as { role?: string; name?: string; children?: unknown[] }[] | undefined)?.forEach(walk);
  };
  walk(a11y as never);

  // screen_id: route + landmark fingerprint
  const url = page.url();
  const landmarkSig = a11y_nodes
    .filter((n) => /banner|main|navigation|complementary|contentinfo|dialog/.test(n.role))
    .map((n) => `${n.role}:${n.name}`)
    .sort()
    .join("|");
  const screenId = `${url}:${createHash("sha1").update(landmarkSig).digest("hex").slice(0, 8)}`;

  return {
    step,
    ts,
    screenshot: screenshotRel,
    domSnapshotSha,
    screenId,
    snapshot: {
      html,
      console: drained.c as Snapshot["console"],
      ipc_errors: drained.i,
      a11y_nodes,
      computed_styles,
    },
  };
}
```

- [ ] **Step 2: Type-check**

```powershell
npx tsc --noEmit
```

Expected: no errors in `capture.ts`.

- [ ] **Step 3: Commit**

```powershell
git add .claude/skills/explore-ux/runner/capture.ts
git commit -m "feat(explore-ux): per-step capture (screenshot + DOM + a11y + console + IPC)" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 8: Catalogue seed flows

**Files:**
- Create: `.claude/skills/explore-ux/flows/catalogue.md`

- [ ] **Step 1: Author catalogue with seed flows**

`flows/catalogue.md`:

````markdown
# Flow Catalogue

Each flow is a YAML block under an `## <id>` heading; see `flow-schema.md`.

## open-folder

```yaml
id: open-folder
name: Open a folder via menu
priority: 1
steps:
  - { kind: press, key: "Control+O" }
  - { kind: wait, ms: 500 }
success_signal:
  selector: "[data-testid='folder-tree']"
recovery:
  - { kind: press, key: "Escape" }
```

## open-file

```yaml
id: open-file
name: Open the first .md file in the tree
priority: 1
preconditions:
  - folder is loaded
steps:
  - { kind: click, selector: "[data-testid='folder-tree'] .file-item:first-child" }
success_signal:
  selector: "[data-testid='viewer']"
```

## tab-switch-churn

```yaml
id: tab-switch-churn
name: Rapidly switch tabs to surface MDR-TAB-CHURN
priority: 2
preconditions:
  - at least 2 tabs are open
steps:
  - { kind: press, key: "Control+Tab" }
  - { kind: press, key: "Control+Tab" }
  - { kind: press, key: "Control+Tab" }
  - { kind: press, key: "Control+Tab" }
  - { kind: press, key: "Control+Tab" }
```

## theme-toggle-flash

```yaml
id: theme-toggle-flash
name: Toggle theme to surface MDR-THEME-FLASH
priority: 2
steps:
  - { kind: click, selector: "[data-testid='theme-toggle']" }
  - { kind: wait, ms: 50 }
  - { kind: click, selector: "[data-testid='theme-toggle']" }
```

## comment-add

```yaml
id: comment-add
name: Add a comment to current file
priority: 1
preconditions:
  - one file is open
steps:
  - { kind: click, selector: "[data-testid='add-comment-btn']" }
  - { kind: type,  selector: "textarea[name='comment']", text: "explore-ux probe" }
  - { kind: click, selector: "button[type='submit']" }
success_signal:
  selector: ".comment-thread .comment:last-child"
recovery:
  - { kind: press, key: "Escape" }
```

## search

```yaml
id: search
name: Workspace search
priority: 2
steps:
  - { kind: press, key: "Control+Shift+F" }
  - { kind: type, selector: "[data-testid='search-input']", text: "the" }
  - { kind: wait, ms: 300 }
success_signal:
  selector: "[data-testid='search-results']"
```

## settings-open

```yaml
id: settings-open
name: Open settings
priority: 3
steps:
  - { kind: press, key: "Control+," }
success_signal:
  selector: "[data-testid='settings-dialog']"
recovery:
  - { kind: press, key: "Escape" }
```

## resize-narrow

```yaml
id: resize-narrow
name: Probe responsive behaviour
priority: 3
steps:
  - { kind: resize, width: 600, height: 800 }
  - { kind: wait, ms: 200 }
  - { kind: resize, width: 1280, height: 800 }
```
````

- [ ] **Step 2: Verify it parses**

Add a quick sanity test inside `runner/flow-schema.test.ts` (append):

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

it("parses the real catalogue.md without error", () => {
  const md = readFileSync(
    join(__dirname, "..", "flows", "catalogue.md"),
    "utf8",
  );
  const flows = parseFlowCatalogue(md);
  expect(flows.length).toBeGreaterThanOrEqual(8);
  expect(flows.map((f) => f.id)).toContain("open-folder");
});
```

```powershell
npx vitest run .claude/skills/explore-ux/runner/flow-schema.test.ts
```

Expected: 4 passed.

- [ ] **Step 3: Commit**

```powershell
git add .claude/skills/explore-ux/flows/catalogue.md .claude/skills/explore-ux/runner/flow-schema.test.ts
git commit -m "feat(explore-ux): seed flow catalogue (8 flows)" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 9: Explore loop + integration test

**Files:**
- Create: `.claude/skills/explore-ux/runner/explore.ts`
- Create: `.claude/skills/explore-ux/runner/explore.integration.test.ts`

- [ ] **Step 1: Write `runner/explore.ts` (driver, no top-level Playwright import — kept lazy so unit tests don't need it)**

```ts
import type { Page } from "@playwright/test";
import { runRules, type RuleHit } from "./analyze";
import { capture, type CaptureBundle } from "./capture";
import type { Flow, FlowStep } from "./flow-schema";

export interface EvidenceBundle extends CaptureBundle {
  flow: string;
  action: FlowStep;
  rule_hits: RuleHit[];
}

export interface ExploreOptions {
  steps: number;          // hard cap
  runDir: string;         // where capture writes screenshots
}

async function executeStep(page: Page, step: FlowStep): Promise<void> {
  switch (step.kind) {
    case "click":  await page.click(step.selector!); break;
    case "type":   await page.fill(step.selector!, step.text ?? ""); break;
    case "press":  await page.keyboard.press(step.key!); break;
    case "hover":  await page.hover(step.selector!); break;
    case "goto":   await page.goto(step.url!); break;
    case "wait":   await page.waitForTimeout(step.ms ?? 100); break;
    case "resize": await page.setViewportSize({
                     width: step.width ?? 1280,
                     height: step.height ?? 800,
                   }); break;
  }
}

/**
 * Iterate up to opts.steps actions across all flows (priority-ordered).
 * Pure driver: takes a Page (real or mocked) and a flow list.
 */
export async function explore(
  page: Page,
  flows: Flow[],
  opts: ExploreOptions,
): Promise<EvidenceBundle[]> {
  const queue = [...flows].sort((a, b) => a.priority - b.priority);
  const bundles: EvidenceBundle[] = [];
  let stepCount = 0;
  for (const flow of queue) {
    for (const step of flow.steps) {
      if (stepCount >= opts.steps) return bundles;
      stepCount += 1;
      try {
        await executeStep(page, step);
      } catch (e) {
        // record failure but continue exploration
        bundles.push({
          step: stepCount,
          ts: new Date().toISOString(),
          flow: flow.id,
          action: step,
          screenshot: "",
          domSnapshotSha: "",
          screenId: "(error)",
          snapshot: {
            html: "",
            console: [{ level: "error", text: `step failed: ${(e as Error).message}` }],
            ipc_errors: [],
            a11y_nodes: [],
            computed_styles: [],
          },
          rule_hits: [{
            id: "MDR-CONSOLE-ERROR",
            detail: `flow ${flow.id} step ${step.kind} failed`,
            anchor: step.selector ?? "(action)",
          }],
        });
        continue;
      }
      const cap = await capture(page, stepCount, opts.runDir);
      const rule_hits = runRules(cap.snapshot);
      bundles.push({ ...cap, flow: flow.id, action: step, rule_hits });
    }
  }
  return bundles;
}
```

- [ ] **Step 2: Write the failing integration test**

`runner/explore.integration.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { explore } from "./explore";
import type { Flow } from "./flow-schema";

function fakePage(scenario: { onClick?: () => void } = {}) {
  return {
    click: vi.fn(async () => scenario.onClick?.()),
    fill: vi.fn(async () => {}),
    keyboard: { press: vi.fn(async () => {}) },
    hover: vi.fn(async () => {}),
    goto: vi.fn(async () => {}),
    waitForTimeout: vi.fn(async () => {}),
    setViewportSize: vi.fn(async () => {}),
    screenshot: vi.fn(async () => {}),
    content: vi.fn(async () => "<html><body>ok</body></html>"),
    evaluate: vi.fn(async (fn: unknown) => {
      // capture.ts uses two evaluate calls: one for drains, one for styles
      const src = typeof fn === "function" ? fn.toString() : String(fn);
      if (src.includes("__exploreUxConsole")) return { c: [], i: [] };
      return [];
    }),
    accessibility: { snapshot: vi.fn(async () => ({ role: "main", name: "", children: [] })) },
    url: () => "tauri://localhost/",
  } as unknown as import("@playwright/test").Page;
}

const FLOW: Flow = {
  id: "demo",
  name: "demo",
  priority: 1,
  steps: [
    { kind: "click", selector: "button.x" },
    { kind: "press", key: "Escape" },
  ],
};

describe("explore loop", () => {
  it("runs every step in flow order and emits one bundle per step", async () => {
    const page = fakePage();
    const dir = mkdtempSync(join(tmpdir(), "ux-int-"));
    const bundles = await explore(page, [FLOW], { steps: 10, runDir: dir });
    expect(bundles).toHaveLength(2);
    expect(bundles[0].flow).toBe("demo");
    expect(bundles[0].action.kind).toBe("click");
  });

  it("respects the steps cap", async () => {
    const page = fakePage();
    const dir = mkdtempSync(join(tmpdir(), "ux-int-"));
    const bundles = await explore(page, [FLOW], { steps: 1, runDir: dir });
    expect(bundles).toHaveLength(1);
  });

  it("records failure as evidence but continues", async () => {
    const page = fakePage({ onClick: () => { throw new Error("boom"); } });
    const dir = mkdtempSync(join(tmpdir(), "ux-int-"));
    const bundles = await explore(page, [FLOW], { steps: 10, runDir: dir });
    expect(bundles).toHaveLength(2);
    expect(bundles[0].rule_hits.map((h) => h.id)).toContain("MDR-CONSOLE-ERROR");
  });
});
```

- [ ] **Step 3: Run test, expect FAIL** (`module not found` initially, then assertion mismatches as you iterate).

```powershell
npx vitest run .claude/skills/explore-ux/runner/explore.integration.test.ts
```

- [ ] **Step 4: Iterate `explore.ts` until tests pass**

Expected after fix: 3 passed.

- [ ] **Step 5: Commit**

```powershell
git add .claude/skills/explore-ux/runner/explore.* 
git commit -m "feat(explore-ux): exploration loop with priority-ordered flow execution" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 10: Report writer

**Files:**
- Create: `.claude/skills/explore-ux/runner/report.ts`

No test — output is consumed by humans; smoke test (Task 13) verifies the file lands on disk.

- [ ] **Step 1: Write `runner/report.ts`**

```ts
import { writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import type { EvidenceBundle } from "./explore";
import type { MergeResult } from "./dedupe";

export function writeEvidenceLine(runDir: string, b: EvidenceBundle): void {
  mkdirSync(runDir, { recursive: true });
  appendFileSync(join(runDir, "evidence.jsonl"), JSON.stringify({
    step: b.step,
    ts: b.ts,
    flow: b.flow,
    action: b.action,
    screen_id: b.screenId,
    screenshot: b.screenshot,
    dom_snapshot_sha: b.domSnapshotSha,
    console_diff: b.snapshot.console,
    ipc_errors: b.snapshot.ipc_errors,
    rule_hits: b.rule_hits,
  }) + "\n");
}

export interface ReportInput {
  runId: string;
  runDir: string;
  startedAt: string;
  finishedAt: string;
  visionEnabled: boolean;
  dryRun: boolean;
  bundles: EvidenceBundle[];
  merges: { bundle: EvidenceBundle; hit: { id: string; detail: string; anchor: string }; merge: MergeResult }[];
}

export function writeReport(input: ReportInput): string {
  const newCount = input.merges.filter((m) => m.merge.status === "NEW").length;
  const reproCount = input.merges.filter((m) => m.merge.status === "REPRODUCED").length;
  const md = [
    `# explore-ux run ${input.runId}`,
    ``,
    `- Started:  ${input.startedAt}`,
    `- Finished: ${input.finishedAt}`,
    `- Steps:    ${input.bundles.length}`,
    `- Vision:   ${input.visionEnabled ? "on" : "off"}`,
    `- Mode:     ${input.dryRun ? "DRY-RUN" : "FILE"}`,
    `- Findings: ${newCount} new, ${reproCount} reproduced`,
    ``,
    `## New findings`,
    ``,
    `| Heuristic | Severity | Screen | Anchor | Screenshot |`,
    `|---|---|---|---|---|`,
    ...input.merges
      .filter((m) => m.merge.status === "NEW")
      .map((m) => `| ${m.hit.id} | — | ${m.bundle.screenId} | \`${m.hit.anchor}\` | ${m.bundle.screenshot} |`),
    ``,
    `## Reproduced findings`,
    ``,
    `| Heuristic | Screen | Reproductions |`,
    `|---|---|---|`,
    ...input.merges
      .filter((m) => m.merge.status === "REPRODUCED")
      .map((m) => `| ${m.hit.id} | ${m.bundle.screenId} | (see known-findings.json) |`),
    ``,
  ].join("\n");
  const path = join(input.runDir, "report.md");
  writeFileSync(path, md);
  return path;
}
```

- [ ] **Step 2: Type-check**

```powershell
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```powershell
git add .claude/skills/explore-ux/runner/report.ts
git commit -m "feat(explore-ux): report writer (markdown + jsonl)" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 11: Issue filer (with dry-run + dedupe integration)

**Files:**
- Create: `.claude/skills/explore-ux/prompts/issue-template.md`
- Create: `.claude/skills/explore-ux/runner/issues.ts`
- Create: `.claude/skills/explore-ux/runner/issues.test.ts`

- [ ] **Step 1: Author `prompts/issue-template.md`**

Static markdown — exactly the template from `docs/specs/skill-explore-ux.md` §8.5.

- [ ] **Step 2: Write the failing test**

`runner/issues.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderIssueBody, fileIssue, type IssueInput } from "./issues";

const INPUT: IssueInput = {
  heuristic_id: "MDR-IPC-RAW-JSON-ERROR",
  heuristic_file: ".claude/skills/explore-ux/heuristics/mdownreview-specific.md",
  severity: "P1",
  reproSteps: ["Open folder", "Click file", "Observe banner"],
  screenshot: "screenshots/step-17.png",
  consoleSnippet: 'Failed to invoke read_text_file: {"kind":"io","message":"Permission denied"}',
  a11ySnippet: "banner has accessible name '...'",
  domAnchor: "div.error-banner",
  suggestion: "Add formatFsError() (cf. src/store/index.ts:399-411).",
  runId: "2026-04-25-22-30",
  step: 17,
  reproductions: 3,
  firstSeen: "2026-04-20",
};

describe("renderIssueBody", () => {
  it("includes heuristic id, severity, repro steps, anchor", () => {
    const md = renderIssueBody(INPUT);
    expect(md).toContain("MDR-IPC-RAW-JSON-ERROR");
    expect(md).toContain("**P1**");
    expect(md).toContain("1. Open folder");
    expect(md).toContain("`div.error-banner`");
    expect(md).toContain("explore-ux run id: `2026-04-25-22-30`");
  });
});

describe("fileIssue", () => {
  it("dry-run does NOT call gh", async () => {
    const gh = vi.fn();
    const r = await fileIssue(INPUT, { dryRun: true, gh });
    expect(gh).not.toHaveBeenCalled();
    expect(r).toMatchObject({ status: "dry-run" });
  });

  it("file mode invokes gh issue create with labels and body file", async () => {
    const gh = vi.fn(async (args: string[]) => {
      // gh issue create --title ... --body-file ... --label ...
      return JSON.stringify({ number: 142, html_url: "https://github.com/x/y/issues/142" });
    });
    const r = await fileIssue(INPUT, { dryRun: false, gh });
    expect(gh).toHaveBeenCalled();
    const args = gh.mock.calls[0][0] as string[];
    expect(args[0]).toBe("issue");
    expect(args[1]).toBe("create");
    expect(args).toContain("--label");
    expect(args).toContain("explore-ux");
    expect(args).toContain("severity-p1");
    expect(r).toMatchObject({ status: "filed", issue: 142 });
  });
});
```

- [ ] **Step 3: Run test, expect FAIL**

```powershell
npx vitest run .claude/skills/explore-ux/runner/issues.test.ts
```

- [ ] **Step 4: Implement `runner/issues.ts`**

```ts
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

export interface IssueInput {
  heuristic_id: string;
  heuristic_file: string;
  severity: "P1" | "P2" | "P3";
  reproSteps: string[];
  screenshot: string;
  consoleSnippet?: string;
  a11ySnippet?: string;
  domAnchor: string;
  suggestion: string;
  runId: string;
  step: number;
  reproductions: number;
  firstSeen: string;
}

export function renderIssueBody(i: IssueInput): string {
  const lines = [
    `## Heuristic`,
    `**${i.heuristic_id}** — see \`${i.heuristic_file}\``,
    ``,
    `## Severity`,
    `**${i.severity}**`,
    ``,
    `## Reproduction`,
    ...i.reproSteps.map((s, idx) => `${idx + 1}. ${s}`),
    ``,
    `## Evidence`,
    `![step-${i.step}](${i.screenshot})`,
    ``,
    `**DOM anchor:** \`${i.domAnchor}\``,
  ];
  if (i.consoleSnippet) lines.push(`**Console:** \`${i.consoleSnippet}\``);
  if (i.a11ySnippet)    lines.push(`**A11y:** ${i.a11ySnippet}`);
  lines.push(
    ``,
    `## Suggested direction`,
    i.suggestion,
    ``,
    `## Run`,
    `explore-ux run id: \`${i.runId}\`, step ${i.step}`,
    `Reproduced ${i.reproductions}× since ${i.firstSeen}.`,
  );
  return lines.join("\n");
}

export type GhExec = (args: string[]) => Promise<string>;

export const realGh: GhExec = (args) =>
  new Promise((resolve, reject) => {
    const p = spawn("gh", args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.once("exit", (code) => code === 0 ? resolve(out) : reject(new Error(err || `gh exit ${code}`)));
  });

export async function fileIssue(
  i: IssueInput,
  opts: { dryRun: boolean; gh?: GhExec },
): Promise<{ status: "dry-run" | "filed"; issue?: number; url?: string }> {
  if (opts.dryRun) return { status: "dry-run" };
  const gh = opts.gh ?? realGh;
  const body = renderIssueBody(i);
  const tmp = mkdtempSync(join(tmpdir(), "ux-issue-"));
  const bodyPath = join(tmp, "body.md");
  writeFileSync(bodyPath, body);
  const labels = ["explore-ux", "needs-grooming", `severity-${i.severity.toLowerCase()}`];
  const isUx = i.heuristic_id.startsWith("NIELSEN-") || i.heuristic_id.startsWith("AP-")
    || i.heuristic_id.startsWith("WCAG-");
  labels.push(isUx ? "ux" : "bug");
  const args = [
    "issue", "create",
    "--title", `[explore-ux] ${i.heuristic_id}: ${i.reproSteps[i.reproSteps.length - 1] ?? "issue"}`,
    "--body-file", bodyPath,
    ...labels.flatMap((l) => ["--label", l]),
    "--json", "number,html_url",
  ];
  const out = await gh(args);
  // gh issue create with --json returns JSON only on newer gh; older versions print URL.
  try {
    const parsed = JSON.parse(out);
    return { status: "filed", issue: parsed.number, url: parsed.html_url };
  } catch {
    const m = /\/issues\/(\d+)/.exec(out);
    return { status: "filed", issue: m ? +m[1] : undefined, url: out.trim() };
  }
}
```

- [ ] **Step 5: Run test, expect PASS**

```powershell
npx vitest run .claude/skills/explore-ux/runner/issues.test.ts
```

Expected: 3 passed.

- [ ] **Step 6: Commit**

```powershell
git add .claude/skills/explore-ux/runner/issues.* .claude/skills/explore-ux/prompts
git commit -m "feat(explore-ux): issue filer with dry-run default and gh CLI integration" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 12: Vision triage prompt + optional sub-agent call

**Files:**
- Create: `.claude/skills/explore-ux/prompts/triage.md`

Vision is invoked by **the SKILL itself**, not by `runner/explore.ts`. The runner writes `runs/<id>/evidence.jsonl` and screenshots; the SKILL reads them and calls a sub-agent. This keeps the runner free of any LLM dependency and makes vision purely additive.

- [ ] **Step 1: Author `prompts/triage.md`**

```markdown
You are the triage agent for the `explore-ux` skill.

## Input
You will receive: a screenshot of the mDown reView app, the URL/route, the action that
was just executed, the visible DOM hash, and the deterministic rule hits already produced
by the rule engine.

## Output
Return a JSON array of findings. Each finding has:

- `heuristic_id`: must be one of the IDs documented in
  `.claude/skills/explore-ux/heuristics/{nielsen,wcag-aa,mdownreview-specific,anti-patterns}.md`.
  Prefer NIELSEN-2 (match real world), NIELSEN-8 (aesthetic & minimal), or AP-* —
  the rule engine handles the others.
- `severity`: P1 / P2 / P3 (see severity mapping in skill-explore-ux.md §7.5).
- `anchor`: a stable DOM selector or "(visual)" if the issue is purely cosmetic.
- `detail`: one sentence describing what is wrong.
- `repro_hint`: one sentence on how to reproduce.

## Rules
- Do NOT invent heuristic IDs. If nothing in the catalogue fits, return an empty array.
- Do NOT comment on Phase 3 polish (spacing/typography drift) unless severity is at least P3 AND the rule engine produced no hits for the same screen.
- Do NOT report things already in the rule_hits input — those are deduped automatically.
- Be terse. One finding per real problem.

Return ONLY the JSON array, no prose.
```

- [ ] **Step 2: Commit**

```powershell
git add .claude/skills/explore-ux/prompts/triage.md
git commit -m "feat(explore-ux): vision triage prompt" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 13: Smoke test (Windows-gated)

**Files:**
- Create: `.claude/skills/explore-ux/runner/explore.smoke.test.ts`
- Modify: `vitest.config.ts` to exclude `*.smoke.test.ts` unless `EXPLORE_UX_SMOKE=1`

- [ ] **Step 1: Modify `vitest.config.ts`**

Locate the `test.exclude` array (or add one). Append:

```ts
test: {
  // ...existing config...
  exclude: [
    ...((existingExclude as string[] | undefined) ?? []),
    ...(process.env.EXPLORE_UX_SMOKE === "1"
      ? []
      : ["**/*.smoke.test.ts"]),
  ],
},
```

If the file uses defaults, add `exclude` and explicitly include `node_modules`/`dist` defaults too (check `vitest` docs).

- [ ] **Step 2: Write `runner/explore.smoke.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const SKIP = process.platform !== "win32" || process.env.EXPLORE_UX_SMOKE !== "1";

describe.skipIf(SKIP)("explore-ux smoke (Windows + EXPLORE_UX_SMOKE=1)", () => {
  it("runs 3 steps end-to-end in dry-run mode", () => {
    const result = spawnSync(
      "npx",
      ["tsx", ".claude/skills/explore-ux/runner/explore.ts",
       "--steps", "3", "--no-vision"],
      { encoding: "utf8", shell: true, timeout: 120_000 },
    );
    expect(result.status).toBe(0);
    // Find latest run dir
    const runs = ".claude/explore-ux/runs";
    expect(existsSync(runs)).toBe(true);
    const latest = readdirSync(runs).sort().pop()!;
    const dir = join(runs, latest);
    expect(existsSync(join(dir, "report.md"))).toBe(true);
    expect(existsSync(join(dir, "evidence.jsonl"))).toBe(true);
    expect(readdirSync(join(dir, "screenshots")).length).toBeGreaterThan(0);
    // Dry-run: known-findings has issue: null
    const known = JSON.parse(readFileSync(".claude/explore-ux/known-findings.json", "utf8"));
    const someFinding = Object.values(known.findings as Record<string, { issue: number | null }>)[0];
    expect(someFinding?.issue ?? null).toBe(null);
  });
});
```

This smoke test depends on Task 14 having already produced a runnable `explore.ts` CLI entry. Order matters — Task 14 next.

- [ ] **Step 3: Commit (test only; will pass after Task 14)**

```powershell
git add .claude/skills/explore-ux/runner/explore.smoke.test.ts vitest.config.ts
git commit -m "test(explore-ux): Windows-gated smoke test scaffold" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 14: CLI entry + npm script + SKILL.md

**Files:**
- Modify: `.claude/skills/explore-ux/runner/explore.ts` — add a `main()` invoked when run as a script
- Create: `.claude/skills/explore-ux/SKILL.md`
- Modify: `package.json` — add `"explore-ux"` script

- [ ] **Step 1: Append CLI to `runner/explore.ts`**

At the bottom of `explore.ts`:

```ts
// ---------------------------------------------------------------------------
// CLI entry: `tsx .claude/skills/explore-ux/runner/explore.ts [args]`
// ---------------------------------------------------------------------------

interface CliArgs {
  steps: number;
  vision: boolean;
  file: boolean;
  auto: boolean;
  noConfirm: boolean;
  seed?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const a: CliArgs = { steps: 50, vision: true, file: false, auto: false, noConfirm: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--steps")     a.steps = Math.min(200, parseInt(argv[++i], 10));
    else if (v === "--no-vision")  a.vision = false;
    else if (v === "--file")       a.file = true;
    else if (v === "--auto")       a.auto = true;
    else if (v === "--no-confirm") a.noConfirm = true;
    else if (v === "--seed")       a.seed = argv[++i];
    else if (v.startsWith("--seed=")) a.seed = v.slice(7);
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (process.platform !== "win32") {
    console.error("[explore-ux] Windows-only in v1. See docs/specs/skill-explore-ux.md §3.");
    process.exit(2);
  }
  // Pre-flight: port 9222 free
  const net = await import("node:net");
  const portFree = await new Promise<boolean>((resolve) => {
    const srv = net.createServer().once("error", () => resolve(false))
      .once("listening", () => srv.close(() => resolve(true)));
    srv.listen(9222, "127.0.0.1");
  });
  if (!portFree) {
    console.error("[explore-ux] CDP port 9222 is in use. Stop other sessions first.");
    process.exit(2);
  }

  const { spawnAppWithCdp } = await import("../../../../e2e/native/global-setup");
  const { chromium } = await import("@playwright/test");
  const { attachDrains } = await import("./capture");
  const { parseFlowCatalogue } = await import("./flow-schema");
  const { readFileSync, mkdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { loadStore, mergeFinding, saveStore } = await import("./dedupe");
  const { writeReport, writeEvidenceLine } = await import("./report");
  const { fileIssue } = await import("./issues");

  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = join(".claude/explore-ux/runs", runId);
  mkdirSync(join(runDir, "screenshots"), { recursive: true });

  console.log(`[explore-ux] Run ${runId} starting (steps=${args.steps}, vision=${args.vision}, file=${args.file})`);

  const { appProc } = await spawnAppWithCdp();
  let exitCode = 0;
  try {
    const browser = await chromium.connectOverCDP("http://localhost:9222");
    const ctx = browser.contexts()[0] ?? await browser.newContext();
    const page = ctx.pages()[0] ?? await ctx.newPage();
    await attachDrains(page);
    const md = readFileSync(".claude/skills/explore-ux/flows/catalogue.md", "utf8");
    const flows = parseFlowCatalogue(md);
    const ordered = args.seed
      ? [...flows.filter((f) => f.id === args.seed), ...flows.filter((f) => f.id !== args.seed)]
      : flows;

    const startedAt = new Date().toISOString();
    const bundles = await explore(page, ordered, { steps: args.steps, runDir });
    const finishedAt = new Date().toISOString();

    bundles.forEach((b) => writeEvidenceLine(runDir, b));

    const storePath = ".claude/explore-ux/known-findings.json";
    const store = loadStore(storePath);
    const merges: { bundle: typeof bundles[number]; hit: typeof bundles[number]["rule_hits"][number]; merge: ReturnType<typeof mergeFinding> }[] = [];
    for (const b of bundles) {
      for (const hit of b.rule_hits) {
        const severity: "P1"|"P2"|"P3" = hit.id.startsWith("MDR-") || hit.id.startsWith("WCAG-") ? "P1"
          : hit.id.startsWith("NIELSEN-") ? "P2" : "P3";
        const merge = mergeFinding(store, {
          heuristic_id: hit.id, screen_id: b.screenId, anchor: hit.anchor,
          severity, detail: hit.detail, screenshot: b.screenshot,
        }, b.ts);
        merges.push({ bundle: b, hit, merge });
      }
    }

    if (args.file) {
      for (const m of merges.filter((m) => m.merge.status === "NEW")) {
        const r = await fileIssue({
          heuristic_id: m.hit.id,
          heuristic_file: ".claude/skills/explore-ux/heuristics/" +
            (m.hit.id.startsWith("NIELSEN-") ? "nielsen.md"
            : m.hit.id.startsWith("WCAG-") ? "wcag-aa.md"
            : m.hit.id.startsWith("MDR-") ? "mdownreview-specific.md"
            : "anti-patterns.md"),
          severity: store.findings[m.merge.key].issue ? "P1" : (m.hit.id.startsWith("MDR-") ? "P1" : m.hit.id.startsWith("WCAG-") ? "P1" : m.hit.id.startsWith("NIELSEN-") ? "P2" : "P3"),
          reproSteps: [`Action: ${m.bundle.action.kind} ${m.bundle.action.selector ?? m.bundle.action.key ?? ""}`, "Observe."],
          screenshot: m.bundle.screenshot,
          domAnchor: m.hit.anchor,
          suggestion: "See heuristic doc for direction.",
          runId,
          step: m.bundle.step,
          reproductions: store.findings[m.merge.key].reproductions,
          firstSeen: store.findings[m.merge.key].first_seen,
        }, { dryRun: false });
        if (r.status === "filed" && r.issue) store.findings[m.merge.key].issue = r.issue;
      }
    }

    saveStore(storePath, store);
    const reportPath = writeReport({
      runId, runDir, startedAt, finishedAt,
      visionEnabled: args.vision, dryRun: !args.file,
      bundles, merges,
    });
    console.log(`[explore-ux] Report: ${reportPath}`);
    await browser.close();
  } catch (e) {
    console.error("[explore-ux] Fatal:", e);
    exitCode = 1;
  } finally {
    try { appProc.kill(); } catch { /* already gone */ }
    process.exit(exitCode);
  }
}

// Detect direct invocation (works under tsx)
import { fileURLToPath } from "node:url";
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main();
}
```

- [ ] **Step 2: Add npm script**

In `package.json` `scripts` block:

```json
"explore-ux": "tsx .claude/skills/explore-ux/runner/explore.ts"
```

- [ ] **Step 3: Add `tsx` if missing**

```powershell
npm ls tsx
# If not installed:
npm install --save-dev tsx
```

- [ ] **Step 4: Author `SKILL.md`**

`.claude/skills/explore-ux/SKILL.md`:

````markdown
---
name: explore-ux
description: Headed Playwright exploration of the live mdownreview app. Drives major flows over CDP, captures screenshot/DOM/a11y/console/IPC evidence, runs heuristic + vision triage, and files deduplicated GitHub issues. Windows-only v1. Args - empty (full catalogue), `--seed <flow-id>` (PR-scoped), `--steps N`, `--no-vision`, `--file` (default dry-run), `--auto`, `--no-confirm`. Spec at docs/specs/skill-explore-ux.md.
---

# explore-ux

**Use when** you want to surface UX issues and functional drift the scripted `e2e/native/` suite misses, especially before merging a PR or after a self-improve cycle. Read-only — never edits app code.

## Pre-flight

1. Confirm OS is Windows.
2. Check port 9222 is free.
3. Confirm a build artefact exists at `src-tauri/target/{debug,release}/mDown reView.exe`.
4. If `--file` is set, confirm `gh auth status` is OK.
5. Ask the user "OK to drive your app for ~N steps?" unless `--no-confirm`.

## Run

```powershell
npm run explore-ux -- [--seed <flow-id>] [--steps N] [--no-vision] [--file] [--auto] [--no-confirm]
```

Defaults: steps=50, vision ON, dry-run (no issues filed).

Outputs:
- `.claude/explore-ux/runs/<ISO-ts>/report.md` — human digest
- `.claude/explore-ux/runs/<ISO-ts>/evidence.jsonl` — per-step bundles
- `.claude/explore-ux/runs/<ISO-ts>/screenshots/` — PNG per step
- `.claude/explore-ux/known-findings.json` — dedupe store

## Optional: vision triage (default on)

After the runner exits, this skill optionally invokes a vision sub-agent (see `prompts/triage.md`) on each evidence bundle's screenshot. Vision findings are merged into the dedupe store using the same `(heuristic-id, screen-id, anchor)` key. Skip with `--no-vision`.

## Phase 6 — file issues

If `--file`:
1. Read latest run's `evidence.jsonl`.
2. For each NEW finding, call `fileIssue(...)` with `dryRun: false` (uses `gh issue create`).
3. For each REPRODUCED finding with an existing open issue, append `gh issue comment "Reproduced in run <id>"`.
4. Update `known-findings.json` with the new issue numbers.

Ask "File these N issues?" unless `--auto`.

## Heuristic catalogue

See `heuristics/{nielsen,wcag-aa,mdownreview-specific,anti-patterns}.md`. Every issue body cites a numbered rule ID — same posture as `AGENTS.md` review rules.

## Non-goals

See `docs/specs/skill-explore-ux.md` §3.
````

- [ ] **Step 5: Run smoke test from Task 13 (now that runner CLI exists)**

```powershell
$env:EXPLORE_UX_SMOKE="1"; npx vitest run .claude/skills/explore-ux/runner/explore.smoke.test.ts
```

Expected: 1 passed (requires built binary; if missing, run `npm run test:e2e:native:build` first).

- [ ] **Step 6: Commit**

```powershell
git add .claude/skills/explore-ux/SKILL.md .claude/skills/explore-ux/runner/explore.ts package.json package-lock.json
git commit -m "feat(explore-ux): SKILL.md + CLI entry + npm script" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 15: Open PR

- [ ] **Step 1: Push and PR**

```powershell
git push -u origin feature/explore-ux-spec
gh pr create --title "feat(explore-ux): exploratory Playwright skill v1" `
  --body "Implements docs/specs/skill-explore-ux.md. Windows-only, dry-run by default, vision ON by default. See plan: docs/specs/skill-explore-ux-plan.md."
```

- [ ] **Step 2: Confirm CI passes**

Verify `npm test` and `npm run lint` pass on the PR. The smoke test stays gated (no `EXPLORE_UX_SMOKE` in CI).

---

## Self-Review

**1. Spec coverage check**

| Spec section | Implementing task |
|---|---|
| §5 Architecture / layout | Task 1, scaffolding |
| §6 State machine | Task 14, SKILL.md + CLI |
| §6.1 Args | Task 14, `parseArgs` |
| §7 Heuristics (4 families) | Task 3 (docs) + Task 5 (detector logic for the rules with deterministic detectors) |
| §8.1 Evidence bundle | Task 7 capture + Task 10 evidence.jsonl |
| §8.2 Console + IPC capture | Task 7 `attachDrains` |
| §8.3 Screen-ID fingerprint | Task 7 `capture()` |
| §8.4 Dedupe key + store | Task 4 |
| §8.5 Issue body template | Task 11 |
| §8.6 Run report | Task 10 |
| §9.1 Unit tests | Tasks 2, 4, 5, 11 |
| §9.2 Integration | Task 9 |
| §9.3 Smoke | Task 13 |
| §10 Risk: port collision | Task 14 main() pre-flight |
| §10 Risk: temp workspace for re-anchoring probe | **Gap** — `comment-add` flow in Task 8 currently runs against whatever workspace the app boots into. Acceptable for v1 because `--seed` defaults to no folder; flow runs only after `open-folder` succeeds, which the user controls via the headed prompt. **Add note** to Task 8: "If user has a real workspace open, the probe writes a sidecar comment with author 'explore-ux probe' that they should manually delete or commit." Tracked in implementation rather than a separate task. |

**2. Placeholder scan** — no TBD/TODO/etc. left in tasks. Vision triage is described as "optional, invoked by skill not runner" — that's a deferred scope, not a placeholder; the SKILL.md describes how to invoke it manually.

**3. Type consistency check**
- `Finding`, `MergeResult` → consistent across `dedupe.ts` (Task 4) and `report.ts`/`explore.ts` (Tasks 10, 14)
- `Snapshot` → defined in `analyze.ts` (Task 5), consumed by `capture.ts` (Task 7)
- `EvidenceBundle` → defined in `explore.ts` (Task 9), consumed by `report.ts` (Task 10) and CLI (Task 14)
- `Flow`, `FlowStep`, `StepKind` → defined in `flow-schema.ts` (Task 2), consumed everywhere downstream
- `IssueInput`, `GhExec` → defined in `issues.ts` (Task 11), consumed in CLI (Task 14)

All names/signatures match across tasks.

---

## Execution Handoff

Plan complete and saved to `docs/specs/skill-explore-ux-plan.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
