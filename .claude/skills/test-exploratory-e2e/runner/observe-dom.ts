// Pure DOM helpers used by the test-exploratory-e2e REPL `observe` action.
//
// These functions are written so they work both in the browser (when
// serialized into Playwright's `page.evaluate`) AND in jsdom (so the
// behaviour can be unit-tested without spinning up a Tauri window).
//
// Issue #149 — surface toggle/active state, classes[], and focused element
// in observe.interactives[] so persona-driven runs can verify toggle/state
// without re-screenshotting.

export type ToggleState = {
  pressed?: boolean;
  checked?: boolean;
  expanded?: boolean;
  selected?: boolean;
  active: boolean;
};

export type FocusedDescriptor = {
  selector: string;
  tag: string;
  name: string;
  classes: string[];
};

/**
 * Reads an ARIA tristate attribute and returns true/false when present and
 * recognised, or null when the attribute is absent or has a non-boolean
 * value (e.g. aria-checked="mixed"). The caller decides whether to omit
 * the field entirely when null.
 */
export function ariaBool(el: Element, attr: string): boolean | null {
  if (!el.hasAttribute(attr)) return null;
  const v = el.getAttribute(attr);
  if (v === "true") return true;
  if (v === "false") return false;
  return null;
}

/**
 * Builds the toggle/active descriptor for an interactive element. Each
 * ARIA boolean is included only when the source attribute is present and
 * recognised; `active` is always included (boolean from classList).
 */
export function buildToggleState(el: Element): ToggleState {
  const out: ToggleState = {
    active: el.classList ? el.classList.contains("active") : false,
  };
  const pressed = ariaBool(el, "aria-pressed");
  if (pressed !== null) out.pressed = pressed;
  const checked = ariaBool(el, "aria-checked");
  if (checked !== null) out.checked = checked;
  const expanded = ariaBool(el, "aria-expanded");
  if (expanded !== null) out.expanded = expanded;
  const selected = ariaBool(el, "aria-selected");
  if (selected !== null) out.selected = selected;
  return out;
}

/**
 * Returns up to `max` class names from the element's classList. Bounded so
 * the observe payload stays small even when an element accumulates many
 * utility/style classes.
 */
export function readClasses(el: Element, max = 6): string[] {
  if (!el.classList) return [];
  const out: string[] = [];
  for (let i = 0; i < el.classList.length && i < max; i++) {
    out.push(el.classList[i]);
  }
  return out;
}

/**
 * Best-effort accessible name (matches the inline logic in repl.ts so the
 * focused descriptor stays consistent with interactive descriptors).
 */
export function ariaName(el: Element): string {
  const aria = el.getAttribute("aria-label");
  if (aria) return aria;
  const title = el.getAttribute("title");
  if (title) return title;
  const text = (el as HTMLElement).innerText ?? el.textContent ?? "";
  return text.trim().slice(0, 80);
}

/**
 * Cheap CSS selector for the focused element. Mirrors the logic in
 * repl.ts's makeSelectorFn but kept independent so unit tests don't
 * depend on the live REPL helper.
 */
export function focusSelector(el: Element): string {
  if (el.id) return `#${el.id}`;
  const tid = el.getAttribute("data-testid");
  const tag = el.tagName.toLowerCase();
  if (tid) return `${tag}[data-testid='${tid}']`;
  const cls = el.classList && el.classList.length > 0 ? `.${el.classList[0]}` : "";
  return `${tag}${cls}`;
}

/**
 * Returns a descriptor for `document.activeElement`, or null when nothing
 * meaningful is focused (body or null). Required for diagnosing focus-leak
 * bugs (e.g. PageDown firing on a stuck toolbar button instead of the
 * scroll container).
 */
export function buildFocused(doc: Document): FocusedDescriptor | null {
  const a = doc.activeElement;
  if (!a || a === doc.body || a === doc.documentElement) return null;
  return {
    selector: focusSelector(a),
    tag: a.tagName.toLowerCase(),
    name: ariaName(a),
    classes: readClasses(a),
  };
}
