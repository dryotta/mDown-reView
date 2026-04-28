import { describe, it, expect } from "vitest";
import { buildBridgeSrcDoc, isBridgeMsg } from "@/lib/html-bridge";

const UUID = "11111111-2222-3333-4444-555555555555";

describe("buildBridgeSrcDoc", () => {
  it("embeds the nonce literal and the script before </body>", () => {
    const out = buildBridgeSrcDoc("<html><body>x</body></html>", { nonce: UUID });
    expect(out).toContain(UUID);
    expect(out).toContain("mdr-html-bridge");
    // script is inserted before </body>, not after
    expect(out.indexOf("<script>")).toBeLessThan(out.indexOf("</body>"));
    expect(out).toContain('data-mdr-link-bridge="true"');
  });

  it("preserves case of the closing body tag", () => {
    const out = buildBridgeSrcDoc("<html><BODY>x</BODY></html>", { nonce: UUID });
    expect(out).toContain("</BODY>");
    expect(out.indexOf("<script>")).toBeLessThan(out.indexOf("</BODY>"));
  });

  it("wraps a fragment that lacks <body> in one", () => {
    const out = buildBridgeSrcDoc("<p>fragment</p>", { nonce: UUID });
    expect(out.startsWith('<body data-mdr-link-bridge="true">')).toBe(true);
    expect(out).toContain("<p>fragment</p>");
    expect(out).toContain("</body>");
    expect(out.indexOf("<script>")).toBeLessThan(out.indexOf("</body>"));
  });

  it("tags body for link bridge", () => {
    const out = buildBridgeSrcDoc("<body>x</body>", { nonce: UUID });
    expect(out).toContain('data-mdr-link-bridge="true"');
  });

  it("rejects non-UUID nonces (defense against script injection)", () => {
    expect(() => buildBridgeSrcDoc("<body>x</body>", { nonce: "n" })).toThrow(/invalid nonce/);
    expect(() => buildBridgeSrcDoc("<body>x</body>", { nonce: '"); evil(); //' })).toThrow(/invalid nonce/);
  });

  it("installs a link-interceptor click handler gated on linkActive()", () => {
    const out = buildBridgeSrcDoc("<body>x</body>", { nonce: UUID });
    expect(out).toContain('type:"link"');
    expect(out).toContain("linkActive()");
    expect(out).toContain('mdrLinkBridge');
  });
});

describe("isBridgeMsg", () => {
  it("accepts a well-formed link message", () => {
    expect(isBridgeMsg({ source: "mdr-html-bridge", nonce: "n", type: "link", href: "https://x" })).toBe(true);
  });
  it("rejects link message with non-string href", () => {
    expect(isBridgeMsg({ source: "mdr-html-bridge", nonce: "n", type: "link", href: 42 })).toBe(false);
    expect(isBridgeMsg({ source: "mdr-html-bridge", nonce: "n", type: "link" })).toBe(false);
  });
  it("rejects selection and click types (comment mode removed)", () => {
    expect(isBridgeMsg({ source: "mdr-html-bridge", nonce: "n", type: "selection" })).toBe(false);
    expect(isBridgeMsg({ source: "mdr-html-bridge", nonce: "n", type: "click" })).toBe(false);
  });
  it("rejects foreign source", () => {
    expect(isBridgeMsg({ source: "other", nonce: "n", type: "click" })).toBe(false);
  });
  it("rejects non-string nonce", () => {
    expect(isBridgeMsg({ source: "mdr-html-bridge", nonce: 1, type: "click" })).toBe(false);
  });
  it("rejects unknown type", () => {
    expect(isBridgeMsg({ source: "mdr-html-bridge", nonce: "n", type: "weird" })).toBe(false);
  });
  it("rejects non-objects", () => {
    expect(isBridgeMsg(null)).toBe(false);
    expect(isBridgeMsg("string")).toBe(false);
  });
});
