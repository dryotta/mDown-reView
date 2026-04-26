// NDJSON command schema for the explore-ux REPL.
//
// Agent (stdin) → REPL: one Command per line.
// REPL (stdout)  → Agent: one Response per line.
//
// Discriminated unions keep parsing trivial and auditable.

export type Command =
  | { act: "screenshot" }
  | { act: "observe" }
  | { act: "click";  selector: string }
  | { act: "press";  key: string }
  | { act: "type";   selector: string; text: string }
  | { act: "hover";  selector: string }
  | { act: "resize"; width: number; height: number }
  | { act: "emit";   event: string }
  | { act: "cli";    args: string[] }
  | { act: "rules" }
  | { act: "record";
      heuristic: string;
      severity: "P1" | "P2" | "P3";
      anchor: string;
      detail: string;
      screenshot: string }
  | { act: "stop" };

export type Interactive = {
  selector: string;       // CSS selector usable by Playwright .click()
  tag: string;            // lowercase tag name
  role: string;           // ARIA role (computed or implicit)
  name: string;           // accessible name (aria-label / text / alt)
  text: string;           // visible text trimmed to 80 chars
  classes: string[];      // first 2 class names (stable anchor candidates)
  bbox: { x: number; y: number; w: number; h: number };
  visible: boolean;
  enabled: boolean;
};

export type Landmark = {
  role: string;           // banner | navigation | main | contentinfo | complementary | dialog
  selector: string;
  label?: string;         // aria-label or first heading
};

export type Observation = {
  url: string;
  title: string;
  screenId: string;       // landmark+heading fingerprint (same scheme as v1)
  viewport: { width: number; height: number };
  interactives: Interactive[];
  landmarks: Landmark[];
  consoleErrors: { ts: string; text: string }[];
  ipcErrors:     { ts: string; cmd: string; error: string }[];
};

export type RuleHit = {
  id: string;
  detail: string;
  anchor: string;
};

export type RecordResult = {
  status: "NEW" | "REPRODUCED";
  key: string;
};

export type StopResult = {
  findings: number;
  newCount: number;
  reproducedCount: number;
  runDir: string;
  reportPath: string;
};

export type Response =
  | { ok: true;  result:
        | { png: string }
        | Observation
        | { ok: true }
        | { hits: RuleHit[] }
        | RecordResult
        | StopResult }
  | { ok: false; error: string };

export function parseCommand(line: string): Command {
  const obj = JSON.parse(line) as Partial<Command>;
  if (!obj || typeof obj !== "object" || typeof obj.act !== "string") {
    throw new Error(`malformed command: ${line.slice(0, 120)}`);
  }
  return obj as Command;
}

export function ok<T>(result: T): Response {
  return { ok: true, result: result as never };
}

export function err(e: unknown): Response {
  const msg = e instanceof Error ? e.message : String(e);
  return { ok: false, error: msg.split("\n")[0].slice(0, 400) };
}
