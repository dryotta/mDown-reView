/**
 * HTML preview commenting bridge.
 *
 * The HTML preview is rendered in a sandboxed iframe (cross-origin srcdoc).
 * To let the user select/click content and turn it into a comment anchor we
 * inject a tiny IIFE that posts events back via `postMessage`. The host
 * filters by `event.source` (the iframe's contentWindow) AND a per-mount
 * `nonce`. Anything else is dropped.
 *
 * Pure helpers — no React, no DOM. The script string is constructed but
 * never evaluated here; it runs inside the iframe at load time.
 */

/* ------------------------------------------------------------------ *
 * Bridge message contracts (the iframe IIFE posts these; the host    *
 * narrows incoming postMessage events through `isBridgeMsg`).        *
 * ------------------------------------------------------------------ */

export interface BridgeSelection {
  source: "mdr-html-bridge";
  nonce: string;
  type: "selection";
  selectorPath: string;
  startOffset: number;
  endOffset: number;
  selectedText: string;
  clientX: number;
  clientY: number;
}

export interface BridgeClick {
  source: "mdr-html-bridge";
  nonce: string;
  type: "click";
  selectorPath: string;
  tag: string;
  textPreview: string;
  clientX: number;
  clientY: number;
}

export type BridgeMsg = BridgeSelection | BridgeClick;

export function isBridgeMsg(d: unknown): d is BridgeMsg {
  if (!d || typeof d !== "object") return false;
  const o = d as Record<string, unknown>;
  return o.source === "mdr-html-bridge" &&
    typeof o.nonce === "string" &&
    (o.type === "selection" || o.type === "click");
}

export interface BuildBridgeOptions {
  /** Per-mount nonce. The host validates incoming messages against this. */
  nonce: string;
}

/**
 * One-shot builder for the iframe `srcDoc` in comment mode. Replaces the
 * older two-step `buildBridgeScript` + `injectBridgeScript` pair.
 *
 * Steps:
 *   1. If `html` lacks a `<body>` tag, wrap it (so the bridge has somewhere
 *      to read `data-mdr-comment-mode` from).
 *   2. Splice `data-mdr-comment-mode="true"` onto the first `<body…>` tag.
 *   3. Build the bridge IIFE with the supplied nonce.
 *   4. Insert the script immediately before `</body>` (or append if none).
 *
 * Behavior of the IIFE:
 *   - On `mouseup` with non-empty selection → posts a `selection` event
 *     with a CSS selector path of the anchor element + offsets.
 *   - On `click` with no selection → posts a `click` event with the
 *     target's selector path, tag, and a short text preview.
 *   - **Anchor clicks** in comment mode call `preventDefault` +
 *     `stopPropagation` so the iframe does NOT navigate to the link
 *     while the host is opening the comment composer (B2 forward-fix).
 *   - Suppressed entirely when `document.body.dataset.mdrCommentMode !== "true"`.
 *   - Skipped on form/button/input targets (preserve native behavior).
 *
 * Selector path: `nth-of-type` chain capped at 5 levels (e.g.
 *   `body > div:nth-of-type(2) > section > p:nth-of-type(3)`).
 */
export function buildBridgeSrcDoc(
  html: string,
  opts: BuildBridgeOptions,
): string {
  const tagged = /<body\b/i.test(html)
    ? html.replace(/<body\b([^>]*)>/i, '<body$1 data-mdr-comment-mode="true">')
    : `<body data-mdr-comment-mode="true">${html}</body>`;
  const script = buildBridgeScript(opts);
  const m = tagged.match(/<\/body\s*>/i);
  if (!m || m.index === undefined) return tagged + script;
  return tagged.slice(0, m.index) + script + tagged.slice(m.index);
}

function buildBridgeScript(opts: BuildBridgeOptions): string {
  const nonce = JSON.stringify(opts.nonce);
  return `<script>(function(){
  var NONCE=${nonce};
  function path(el){
    if(!el||el.nodeType!==1) return "";
    var parts=[],n=el,depth=0;
    while(n&&n.nodeType===1&&n!==document.documentElement&&depth<5){
      var name=n.tagName.toLowerCase();
      var p=n.parentElement;
      if(p){
        var same=0,idx=0,i;
        for(i=0;i<p.children.length;i++){
          var c=p.children[i];
          if(c.tagName===n.tagName){same++;if(c===n) idx=same;}
        }
        if(same>1) name+=":nth-of-type("+idx+")";
      }
      parts.unshift(name);
      n=p; depth++;
    }
    return parts.join(" > ");
  }
  function active(){return document.body&&document.body.dataset&&document.body.dataset.mdrCommentMode==="true";}
  function isFormTarget(t){
    if(!t||!t.tagName) return false;
    var tag=t.tagName.toLowerCase();
    return tag==="input"||tag==="textarea"||tag==="button"||tag==="select"||tag==="option";
  }
  document.addEventListener("mouseup",function(e){
    if(!active()) return;
    if(isFormTarget(e.target)) return;
    var sel=window.getSelection&&window.getSelection();
    if(!sel) return;
    var text=sel.toString();
    if(!text||!text.length) return;
    var range=sel.rangeCount>0?sel.getRangeAt(0):null;
    if(!range) return;
    var anchor=range.startContainer;
    var anchorEl=anchor&&anchor.nodeType===1?anchor:(anchor&&anchor.parentElement);
    parent.postMessage({
      source:"mdr-html-bridge",nonce:NONCE,type:"selection",
      selectorPath:path(anchorEl),
      startOffset:range.startOffset,endOffset:range.endOffset,
      selectedText:text.slice(0,256),
      clientX:e.clientX,clientY:e.clientY
    },"*");
  },true);
  document.addEventListener("click",function(e){
    if(!active()) return;
    if(isFormTarget(e.target)) return;
    var t=e.target;
    if(!t||t.nodeType!==1) return;
    // B2 forward-fix (iter 11): anchor click suppression must run BEFORE
    // the selection-non-empty early-return. Otherwise an anchor click while
    // a selection is active would skip preventDefault and let the iframe
    // navigate. preventDefault/stopPropagation are safe regardless of
    // whether we end up posting a click message.
    if(t.closest && t.closest("a")){
      e.preventDefault();
      e.stopPropagation();
    }
    var sel=window.getSelection&&window.getSelection();
    if(sel&&sel.toString().length>0) return;
    parent.postMessage({
      source:"mdr-html-bridge",nonce:NONCE,type:"click",
      selectorPath:path(t),
      tag:t.tagName.toLowerCase(),
      textPreview:(t.textContent||"").slice(0,80),
      clientX:e.clientX,clientY:e.clientY
    },"*");
  },true);
})();</script>`;
}
