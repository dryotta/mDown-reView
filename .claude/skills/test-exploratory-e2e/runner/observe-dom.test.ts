import { describe, it, expect, beforeEach } from "vitest";
import {
  ariaBool,
  buildToggleState,
  readClasses,
  buildFocused,
  ariaName,
  focusSelector,
} from "./observe-dom";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("ariaBool", () => {
  it("returns true / false when the attribute is set to a recognised string", () => {
    const a = document.createElement("button");
    a.setAttribute("aria-pressed", "true");
    expect(ariaBool(a, "aria-pressed")).toBe(true);

    const b = document.createElement("button");
    b.setAttribute("aria-pressed", "false");
    expect(ariaBool(b, "aria-pressed")).toBe(false);
  });

  it("returns null when the attribute is absent or unrecognised", () => {
    const a = document.createElement("button");
    expect(ariaBool(a, "aria-pressed")).toBeNull();

    const b = document.createElement("input");
    b.setAttribute("aria-checked", "mixed");
    expect(ariaBool(b, "aria-checked")).toBeNull();
  });
});

describe("buildToggleState", () => {
  it("surfaces aria-pressed for toggle buttons", () => {
    const on = document.createElement("button");
    on.setAttribute("aria-pressed", "true");
    expect(buildToggleState(on)).toEqual({ pressed: true, active: false });

    const off = document.createElement("button");
    off.setAttribute("aria-pressed", "false");
    expect(buildToggleState(off)).toEqual({ pressed: false, active: false });
  });

  it("surfaces aria-checked for switch/checkbox roles", () => {
    const sw = document.createElement("input");
    sw.setAttribute("role", "switch");
    sw.setAttribute("aria-checked", "true");
    expect(buildToggleState(sw)).toEqual({ checked: true, active: false });
  });

  it("surfaces aria-expanded for disclosure-style controls", () => {
    const summary = document.createElement("summary");
    summary.setAttribute("aria-expanded", "true");
    expect(buildToggleState(summary)).toEqual({ expanded: true, active: false });
  });

  it("surfaces aria-selected for tab-like controls", () => {
    const tab = document.createElement("div");
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", "false");
    expect(buildToggleState(tab)).toEqual({ selected: false, active: false });
  });

  it("surfaces .active class membership independent of ARIA state", () => {
    const tab = document.createElement("button");
    tab.className = "tab active";
    expect(buildToggleState(tab)).toEqual({ active: true });
  });

  it("omits ARIA fields when the source attribute is absent", () => {
    const plain = document.createElement("button");
    plain.className = "toolbar-btn";
    const state = buildToggleState(plain);
    expect(state).toEqual({ active: false });
    expect(state).not.toHaveProperty("pressed");
    expect(state).not.toHaveProperty("checked");
    expect(state).not.toHaveProperty("expanded");
    expect(state).not.toHaveProperty("selected");
  });

  it("combines multiple ARIA booleans with .active when present", () => {
    const el = document.createElement("button");
    el.className = "viewer-toolbar-btn active";
    el.setAttribute("aria-pressed", "true");
    el.setAttribute("aria-expanded", "false");
    expect(buildToggleState(el)).toEqual({
      pressed: true,
      expanded: false,
      active: true,
    });
  });
});

describe("readClasses", () => {
  it("returns every class up to the cap, in classList order", () => {
    const el = document.createElement("div");
    el.className = "a b c d";
    expect(readClasses(el)).toEqual(["a", "b", "c", "d"]);
  });

  it("caps the array at the requested max", () => {
    const el = document.createElement("div");
    el.className = "a b c d e f g h";
    expect(readClasses(el, 3)).toEqual(["a", "b", "c"]);
  });

  it("returns [] for elements with no classes", () => {
    const el = document.createElement("div");
    expect(readClasses(el)).toEqual([]);
  });
});

describe("buildFocused", () => {
  it("returns null when nothing meaningful is focused", () => {
    expect(buildFocused(document)).toBeNull();
  });

  it("describes the focused element with selector / tag / name / classes", () => {
    const btn = document.createElement("button");
    btn.id = "settings-btn";
    btn.className = "toolbar-btn primary";
    btn.setAttribute("aria-label", "Open settings");
    document.body.appendChild(btn);
    btn.focus();

    expect(buildFocused(document)).toEqual({
      selector: "#settings-btn",
      tag: "button",
      name: "Open settings",
      classes: ["toolbar-btn", "primary"],
    });
  });

  it("falls back to tag.class selector when the element has no id", () => {
    const btn = document.createElement("button");
    btn.className = "viewer-toolbar-btn";
    btn.textContent = "Wrap";
    document.body.appendChild(btn);
    btn.focus();

    const focused = buildFocused(document);
    expect(focused?.selector).toBe("button.viewer-toolbar-btn");
    expect(focused?.tag).toBe("button");
  });
});

describe("observe roundtrip — pressed flips after toggling the source attribute", () => {
  // Skill-self-test for issue #149: simulates the observe→click→observe
  // sequence the persona-driven REPL goes through. Uses jsdom + the same
  // pure helpers the in-page evaluate body uses, so any drift in the
  // descriptor builder breaks this test.
  it("captures pressed=false, flips to pressed=true after the click is applied", () => {
    const btn = document.createElement("button");
    btn.className = "viewer-toolbar-btn";
    btn.textContent = "Wrap";
    btn.setAttribute("aria-pressed", "false");
    document.body.appendChild(btn);

    const before = buildToggleState(btn);
    expect(before.pressed).toBe(false);
    expect(before.active).toBe(false);

    // Simulate the side-effect of clicking the toggle: aria-pressed flips
    // and the chrome adds .active. Mirrors what mdownreview's toolbar does.
    btn.setAttribute("aria-pressed", "true");
    btn.classList.add("active");

    const after = buildToggleState(btn);
    expect(after.pressed).toBe(true);
    expect(after.active).toBe(true);
  });
});

describe("ariaName / focusSelector", () => {
  it("ariaName prefers aria-label, then title, then trimmed text", () => {
    const a = document.createElement("button");
    a.setAttribute("aria-label", "Aria");
    a.setAttribute("title", "Title");
    a.textContent = "Text";
    expect(ariaName(a)).toBe("Aria");

    const b = document.createElement("button");
    b.setAttribute("title", "Title");
    b.textContent = "Text";
    expect(ariaName(b)).toBe("Title");

    const c = document.createElement("button");
    c.textContent = "  Text  ";
    expect(ariaName(c)).toBe("Text");
  });

  it("focusSelector prefers id, then data-testid, then tag.class", () => {
    const idEl = document.createElement("button");
    idEl.id = "x";
    expect(focusSelector(idEl)).toBe("#x");

    const tidEl = document.createElement("div");
    tidEl.setAttribute("data-testid", "save-btn");
    expect(focusSelector(tidEl)).toBe("div[data-testid='save-btn']");

    const clsEl = document.createElement("button");
    clsEl.className = "btn primary";
    expect(focusSelector(clsEl)).toBe("button.btn");
  });
});
