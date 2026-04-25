// URL-scheme classifiers used by viewer link handlers AND by the external-URL
// chokepoint in `lib/tauri-commands.ts`. Hoisted to one place so the viewer
// classifies clicks the same way the plugin gate enforces.
//
// Allowed external schemes: http(s), mailto, tel.
// Explicitly blocked: javascript, file, data, vbscript.
//
// The split is intentional — `EXTERNAL_LINK_SCHEME` is "delegate to OS
// opener", `BLOCKED_LINK_SCHEME` is "drop with a warn". Any scheme matching
// neither is treated as a workspace-relative path by viewer handlers.

export const EXTERNAL_LINK_SCHEME = /^(https?|mailto|tel):/i;
export const BLOCKED_LINK_SCHEME = /^(javascript|file|data|vbscript):/i;
