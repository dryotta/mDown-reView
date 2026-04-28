/**
 * HTML preview link-routing bridge.
 *
 * The HTML preview is rendered in a sandboxed iframe (cross-origin srcdoc).
 * When scripts are enabled, we inject a tiny IIFE that intercepts link clicks
 * and posts events back via `postMessage`. The host filters by `event.source`
 * (the iframe's contentWindow) AND a per-mount `nonce`. Anything else is dropped.
 *
 * Pure helpers — no React, no DOM. The script string is constructed but
 * never evaluated here; it runs inside the iframe at load time.
 */

/* ------------------------------------------------------------------ *
 * Bridge message contracts (the iframe IIFE posts these; the host    *
 * narrows incoming postMessage events through `isBridgeMsg`).        *
 * ------------------------------------------------------------------ */

export interface BridgeLink {
  source: "mdr-html-bridge";
  nonce: string;
  type: "link";
  href: string;
}

export type BridgeMsg = BridgeLink;

export function isBridgeMsg(d: unknown): d is BridgeMsg {
  if (!d || typeof d !== "object") return false;
  const o = d as Record<string, unknown>;
  if (o.source !== "mdr-html-bridge" || typeof o.nonce !== "string") return false;
  if (o.type === "link" && typeof o.href === "string") return true;
  return false;
}

export interface BuildBridgeOptions {
  /** Per-mount nonce. The host validates incoming messages against this. */
  nonce: string;
}

/**
 * One-shot builder for the iframe `srcDoc` in scripts mode. Injects the
 * bridge IIFE that intercepts link clicks and posts them back to the host
 * via `postMessage`. The link interceptor is always installed when the
 * bridge is loaded.
 *
 * Steps:
 *   1. If `html` lacks a `<body>` tag, wrap it.
 *   2. Splice `data-mdr-link-bridge="true"` onto the first `<body…>` tag.
 *   3. Build the bridge IIFE with the supplied nonce.
 *   4. Insert the script immediately before `</body>` (or append if none).
 */
export function buildBridgeSrcDoc(
  html: string,
  opts: BuildBridgeOptions,
): string {
  const attrs = 'data-mdr-link-bridge="true"';
  const tagged = /<body\b/i.test(html)
    ? html.replace(/<body\b([^>]*)>/i, `<body$1 ${attrs}>`)
    : `<body ${attrs}>${html}</body>`;
  const script = buildBridgeScript(opts);
  const m = tagged.match(/<\/body\s*>/i);
  if (!m || m.index === undefined) return tagged + script;
  return tagged.slice(0, m.index) + script + tagged.slice(m.index);
}

function buildBridgeScript(opts: BuildBridgeOptions): string {
  // Defense-in-depth: nonce must match the format we produce
  // (`crypto.randomUUID`). Reject anything else BEFORE we splice it into a
  // <script> body — a malformed nonce is the only way the JSON-stringified
  // value below could escape its string literal.
  if (!/^[0-9a-f-]{36}$/i.test(opts.nonce)) {
    throw new Error("buildBridgeScript: invalid nonce");
  }
  const nonce = JSON.stringify(opts.nonce);
  return `<script>(function(){
  var NONCE=${nonce};
  function linkActive(){return document.body&&document.body.dataset&&document.body.dataset.mdrLinkBridge==="true";}
  // Link interceptor — runs whenever the bridge is loaded. Posts the raw
  // href to the parent which routes it through the shared routeLinkClick
  // chokepoint.
  document.addEventListener("click",function(e){
    if(!linkActive()) return;
    var t=e.target;
    var a=t&&t.closest&&t.closest("a");
    if(!a) return;
    var href=a.getAttribute("href");
    if(href===null) return;
    e.preventDefault();
    e.stopPropagation();
    parent.postMessage({source:"mdr-html-bridge",nonce:NONCE,type:"link",href:href},"*");
  },true);
})();</script>`;
}
