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
  const buttonRe = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
  const emojiRe = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2700}-\u{27BF}\u{1F000}-\u{1F2FF}]|[\u00D7\u2715\u2716\u2717\u2718\u00D8\u2304\u2303]/u;
  const hits: RuleHit[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = buttonRe.exec(s.html)) !== null) {
    const attrs = m[1];
    const inner = m[2];
    if (!emojiRe.test(inner) || /<(svg|img)\b/i.test(inner)) continue;
    const aria = /aria-label=(?:"|')([^"']+)(?:"|')/i.exec(attrs)?.[1];
    const testid = /data-testid=(?:"|')([^"']+)(?:"|')/i.exec(attrs)?.[1];
    const cls = /class=(?:"|')([^"']+)(?:"|')/i.exec(attrs)?.[1]?.split(/\s+/)[0];
    const text = inner.replace(/<[^>]+>/g, "").trim().slice(0, 24);
    const anchor = testid ? `button[data-testid='${testid}']`
      : cls ? `button.${cls}`
      : aria ? `button[aria-label='${aria}']`
      : text ? `button:has-text("${text}")`
      : "button";
    if (seen.has(anchor)) continue;
    seen.add(anchor);
    hits.push({
      id: "AP-EMOJI-AS-ICON",
      detail: aria ? `button "${aria}" uses emoji "${text}"` : `button uses emoji "${text}" as icon`,
      anchor,
    });
  }
  return hits;
};

const ruleMdrSyntaxFail: Rule = (s) => {
  const codeBlockRe = /<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi;
  const hits: RuleHit[] = [];
  let m: RegExpExecArray | null;
  while ((m = codeBlockRe.exec(s.html)) !== null) {
    const inner = m[1];
    if (!inner.trim()) continue;
    const spans = inner.match(/<span[^>]*>/g);
    if (!spans || spans.length === 0) continue;
    const styledSpans = spans.filter((sp) => /style="[^"]*color:/i.test(sp));
    if (styledSpans.length === 0) {
      hits.push({
        id: "MDR-SYNTAX-FAIL",
        detail: `code block has ${spans.length} spans but none with inline color — tokens may render uniform black`,
        anchor: "pre > code",
      });
    }
  }
  return hits;
};

const ruleMdrBlankViewer: Rule = (s) => {
  const viewerRe = /<(?:div|main|section)[^>]*class="[^"]*(?:viewer-content|markdown-body|source-view)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|main|section)>/gi;
  const hits: RuleHit[] = [];
  let m: RegExpExecArray | null;
  while ((m = viewerRe.exec(s.html)) !== null) {
    const inner = m[1].replace(/<[^>]+>/g, "").trim();
    if (inner.length === 0) {
      const cls = /class="([^"]*)"/.exec(m[0]);
      hits.push({
        id: "MDR-BLANK-VIEWER",
        detail: "viewer pane is empty — no visible text content after file load",
        anchor: cls ? `div.${cls[1].split(/\s+/)[0]}` : "div.viewer-content",
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
  ruleMdrSyntaxFail,
  ruleMdrBlankViewer,
];

export function runRules(snapshot: Snapshot): RuleHit[] {
  return RULES.flatMap((r) => r(snapshot));
}
