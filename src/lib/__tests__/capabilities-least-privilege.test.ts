import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const CAPABILITIES_PATH = resolve(
  __dirname,
  "../../../src-tauri/capabilities/default.json",
);

interface Capabilities {
  identifier: string;
  windows: string[];
  permissions: string[];
}

function loadCapabilities(): Capabilities {
  const raw = readFileSync(CAPABILITIES_PATH, "utf-8");
  return JSON.parse(raw) as Capabilities;
}

const OVERLY_BROAD_PERMISSIONS = [
  "core:default",
  "core:tray:default",
  "core:image:default",
  "core:resources:default",
  "core:path:default",
  "core:webview:default",
  "dialog:default",
  "opener:default",
  "clipboard-manager:default",
];

describe("Tauri capabilities least-privilege", () => {
  const caps = loadCapabilities();

  it("does not include overly broad core:default", () => {
    expect(caps.permissions).not.toContain("core:default");
  });

  it("does not include any known overly broad permission", () => {
    for (const broad of OVERLY_BROAD_PERMISSIONS) {
      expect(caps.permissions, `should not contain ${broad}`).not.toContain(
        broad,
      );
    }
  });

  it("includes required core sub-permissions", () => {
    expect(caps.permissions).toContain("core:app:default");
    expect(caps.permissions).toContain("core:event:default");
    expect(caps.permissions).toContain("core:menu:default");
    expect(caps.permissions).toContain("core:window:default");
  });

  it("uses narrow dialog permission instead of dialog:default", () => {
    expect(caps.permissions).not.toContain("dialog:default");
    expect(caps.permissions).toContain("dialog:allow-open");
  });

  it("uses narrow clipboard permission instead of clipboard-manager:default", () => {
    expect(caps.permissions).not.toContain("clipboard-manager:default");
    expect(caps.permissions).toContain("clipboard-manager:allow-write-text");
  });

  it("uses narrow opener permission instead of opener:default", () => {
    expect(caps.permissions).not.toContain("opener:default");
    expect(caps.permissions).toContain("opener:allow-open-url");
  });

  it("includes updater permissions for auto-update workflow", () => {
    expect(caps.permissions).toContain("updater:default");
  });

  it("includes log plugin permission", () => {
    expect(caps.permissions).toContain("log:default");
  });

  it("scopes capabilities to only the main window", () => {
    expect(caps.windows).toEqual(["main"]);
  });
});
