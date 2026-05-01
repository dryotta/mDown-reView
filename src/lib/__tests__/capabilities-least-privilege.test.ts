import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const CAPABILITIES_PATH = resolve(
  __dirname,
  "../../../src-tauri/capabilities/default.json",
);

const TAURI_CONF_PATH = resolve(
  __dirname,
  "../../../src-tauri/tauri.conf.json",
);

interface Capabilities {
  identifier: string;
  windows: string[];
  permissions: string[];
}

interface TauriConf {
  app: {
    security: {
      assetProtocol?: {
        enable: boolean;
        scope: string[];
      };
    };
  };
}

function loadCapabilities(): Capabilities {
  const raw = readFileSync(CAPABILITIES_PATH, "utf-8");
  return JSON.parse(raw) as Capabilities;
}

function loadTauriConf(): TauriConf {
  const raw = readFileSync(TAURI_CONF_PATH, "utf-8");
  return JSON.parse(raw) as TauriConf;
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

  // Without `opener:allow-default-urls` the URL-scope check rejects every
  // call to `openUrl()`, so external links from the markdown / HTML viewers
  // silently fail. This permission is the canned scope for http(s)/mailto/tel,
  // matching the JS-side `EXTERNAL_LINK_SCHEME` allowlist in `lib/url-policy.ts`.
  it("includes opener:allow-default-urls so http(s)/mailto/tel URLs pass the scope check", () => {
    expect(caps.permissions).toContain("opener:allow-default-urls");
  });

  it("includes updater permissions for auto-update workflow", () => {
    expect(caps.permissions).toContain("updater:default");
  });

  it("includes log plugin permission", () => {
    expect(caps.permissions).toContain("log:default");
  });

  it("scopes capabilities to main and dynamically created windows", () => {
    expect(caps.windows).toEqual(["main", "win-*"]);
  });
});

// Issue #338 / Group A3 — Tiered link & asset policy (foundation).
// The static `assetProtocol.scope` in tauri.conf.json must be a non-matching
// seed; real allowances are extended at runtime via
// `app.asset_protocol_scope().allow_directory(...)` from src-tauri/src/lib.rs
// when each window's WindowKind::Folder / WindowKind::FileOnly is registered.
// See rule 17 in docs/security.md (least-privilege asset-protocol scope) and
// the runtime-narrowing model. We avoid snapshotting the entire conf JSON to
// prevent drift on every unrelated capability/CSP edit (test-strategy.md
// IPC mock hygiene principle: assert the load-bearing field, not the document).
describe("Tauri assetProtocol scope (issue #338, Group A3)", () => {
  const conf = loadTauriConf();
  const scope = conf.app.security.assetProtocol?.scope;

  it("is enabled (the protocol itself stays on for in-workspace assets)", () => {
    expect(conf.app.security.assetProtocol?.enable).toBe(true);
  });

  it("uses a non-matching seed, not the legacy [\"**\"] glob", () => {
    expect(scope).toEqual(["/__mdownreview_seed__/__never__"]);
    expect(scope).not.toEqual(["**"]);
  });
});
