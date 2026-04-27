import { basename, extname } from "@/lib/path-utils";

export type FileCategory =
  | "markdown"
  | "json"
  | "csv"
  | "html"
  | "mermaid"
  | "kql"
  | "image"
  | "audio"
  | "video"
  | "pdf"
  | "text";

const CATEGORY_MAP: Record<string, FileCategory> = {
  ".md": "markdown",
  ".mdx": "markdown",
  ".json": "json",
  ".jsonc": "json",
  ".csv": "csv",
  ".tsv": "csv",
  ".html": "html",
  ".htm": "html",
  ".mermaid": "mermaid",
  ".mmd": "mermaid",
  ".kql": "kql",
  ".csl": "kql",
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".gif": "image",
  ".svg": "image",
  ".webp": "image",
  ".bmp": "image",
  ".ico": "image",
  ".pdf": "pdf",
  ".mp3": "audio",
  ".wav": "audio",
  ".ogg": "audio",
  ".flac": "audio",
  ".m4a": "audio",
  ".aac": "audio",
  ".mp4": "video",
  ".webm": "video",
  ".mov": "video",
  ".mkv": "video",
};

// Audio and video are handled by their own dedicated viewers (AudioViewer /
// VideoViewer) — they don't share the source/visual toggle, but are listed as
// "visualizable" so that filetype-keyed UI behaviour (toolbar, zoom store) is
// consistent with the other media-only category, image. Zoom is not actually
// applied to audio/video controls.
const VISUALIZABLE: Set<FileCategory> = new Set([
  "markdown",
  "json",
  "csv",
  "html",
  "mermaid",
  "kql",
  "pdf",
  "audio",
  "video",
]);

const DEFAULT_VIEW: Record<FileCategory, "source" | "visual"> = {
  markdown: "visual",
  json: "visual",
  csv: "visual",
  html: "source",
  mermaid: "visual",
  kql: "visual",
  image: "visual",
  pdf: "visual",
  audio: "visual",
  video: "visual",
  text: "source",
};

export function getFileCategory(path: string): FileCategory {
  const ext = extname(path);
  return CATEGORY_MAP[ext] ?? "text";
}

/**
 * Canonical filetype key used by the per-filetype zoom store
 * (`zoomByFiletype`). Several extensions collapse to one key (`.md` covers
 * both md/mdx; `.image` covers all bitmap/vector image extensions); the
 * `source` view of a visualizable file uses `.source` so source-mode zoom is
 * independent of visual-mode zoom for the same document.
 */
export function getFiletypeKey(path: string, viewMode?: "source" | "visual"): string {
  const cat = getFileCategory(path);
  if (cat === "image") return ".image";
  if (cat === "audio") return ".audio";
  if (cat === "video") return ".video";
  if (cat === "pdf") return ".pdf";
  const view = viewMode ?? getDefaultView(cat);
  if (view === "source") return ".source";
  switch (cat) {
    case "markdown": return ".md";
    case "json": return ".json";
    case "csv": return ".csv";
    case "html": return ".html";
    case "mermaid": return ".mmd";
    case "kql": return ".kql";
    default: return ".source";
  }
}

export function hasVisualization(category: FileCategory): boolean {
  return VISUALIZABLE.has(category);
}

export function getDefaultView(category: FileCategory): "source" | "visual" {
  return DEFAULT_VIEW[category];
}

// Map file extension → Shiki language id. The same ids are also accepted by
// the Rust fold-region detector (`src-tauri/src/core/fold_regions.rs`), which
// recognises both `python`/`py` and `yaml`/`yml` for its indent-language hint,
// so this single table serves both syntax highlighting and folding.
//
// Every value here MUST be either a key of Shiki's `bundledLanguages` (so
// `loadLanguage(id)` succeeds at runtime) or the special `kql` id which is
// registered separately from `kql.tmLanguage.json`. The runtime guard test
// in `src/lib/__tests__/file-types.test.ts` enforces this — a typo or
// Shiki-version drift fails fast there instead of silently degrading to
// `text` (Shiki swallows `loadLanguage` errors).
//
// `.m` is intentionally NOT mapped: ambiguous between Objective-C, MATLAB,
// and Mathematica. Falls back to `text` until product picks a default.
// Niche languages (clj, hs, elm, ml, fs, nim, cr, jl, tex, vim, pl) are
// deferred to keep the table tight; re-add only on user request.
//
// Aliases that Shiki does not bundle directly:
// - `.gradle` → `groovy`     (Gradle DSL is Groovy)
// - `.conf`/`.env` → `ini`   (close-enough syntax for highlighting)
const SHIKI_LANGUAGE_MAP: Record<string, string> = {
  // TS / JS family
  ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
  // Mainstream languages
  py: "python", rs: "rust", go: "go", java: "java",
  c: "c", cpp: "cpp", h: "c", cs: "csharp", swift: "swift", kt: "kotlin",
  rb: "ruby", php: "php", lua: "lua", dart: "dart", scala: "scala", zig: "zig",
  r: "r", groovy: "groovy",
  // Web / app frameworks
  css: "css", html: "html", svelte: "svelte", vue: "vue", astro: "astro",
  graphql: "graphql", gql: "graphql", prisma: "prisma",
  // Data / config
  json: "json", jsonc: "jsonc", yaml: "yaml", yml: "yaml", toml: "toml",
  xml: "xml", ini: "ini", conf: "ini", env: "ini",
  // Shells / scripts
  sh: "bash", bash: "bash", ps1: "powershell",
  // Docs / misc
  md: "markdown", sql: "sql",
  // Infra / config
  tf: "terraform", tfvars: "terraform", hcl: "hcl",
  proto: "proto", gradle: "groovy", cmake: "cmake", bicep: "bicep",
  diff: "diff", patch: "diff",
  // Apple
  mm: "objective-cpp",
  // KQL — registered separately via custom TextMate grammar
  kql: "kql", csl: "kql",
};

// Filename-only patterns matched when there is no recognisable extension.
// Lookups are case-insensitive (`Dockerfile`/`dockerfile`). Extensions WIN
// when present — `foo.Dockerfile` falls through to extension lookup (which
// has no `.dockerfile` entry) and ends up as `text`.
const BASENAME_MAP: Record<string, string> = {
  dockerfile: "docker",
  containerfile: "docker",
  makefile: "make",
  gnumakefile: "make",
  "cmakelists.txt": "cmake",
};

// Exported for the runtime guard test (file-types.test.ts) which verifies
// every value is a key of Shiki's `bundledLanguages` (or `kql`).
export const SHIKI_LANGUAGE_MAP_FOR_TEST: Readonly<Record<string, string>> = SHIKI_LANGUAGE_MAP;
export const BASENAME_MAP_FOR_TEST: Readonly<Record<string, string>> = BASENAME_MAP;

export function getShikiLanguage(path: string): string {
  // Filename-only patterns take precedence — `CMakeLists.txt` is in the
  // basename map even though `.txt` has no extension entry, and bare
  // `Dockerfile`/`Makefile` have no extension at all. Lookups are
  // case-insensitive. Files like `foo.Dockerfile` (basename
  // `foo.dockerfile`, lowercase) are NOT in the map and fall through to
  // the extension lookup — which has no `.dockerfile` entry, yielding
  // `text`. This preserves the spec rule that genuine extensions win when
  // present.
  const base = basename(path).toLowerCase();
  const fromBase = BASENAME_MAP[base];
  if (fromBase) return fromBase;

  const ext = extname(path).slice(1);
  return ext ? (SHIKI_LANGUAGE_MAP[ext] ?? "text") : "text";
}

// Fold-region language hint. Currently identical to the Shiki id space — the
// Rust side only inspects the value to decide between brace- and indent-based
// folding and accepts the Shiki names. Kept as a separate export so future
// divergence has an obvious seam.
export function getFoldLanguage(path: string): string {
  return getShikiLanguage(path);
}

// ── Binary placeholder iconography ────────────────────────────────────────
// The BinaryPlaceholder viewer picks an icon from a small inline SVG map
// (`BinaryPlaceholder.tsx`). The category here is icon-only — it has no
// effect on routing — and intentionally narrow so the inline map stays tiny.
export type BinaryIconCategory =
  | "archive"
  | "audio"
  | "video"
  | "pdf"
  | "font"
  | "exe"
  | "image"
  | "other";

const BINARY_ICON_MAP: Record<string, BinaryIconCategory> = {
  ".zip": "archive", ".tar": "archive", ".gz": "archive", ".tgz": "archive",
  ".bz2": "archive", ".7z": "archive", ".rar": "archive", ".xz": "archive",
  ".mp3": "audio", ".wav": "audio", ".ogg": "audio", ".flac": "audio",
  ".m4a": "audio", ".aac": "audio",
  ".mp4": "video", ".webm": "video", ".mov": "video", ".mkv": "video",
  ".avi": "video",
  ".pdf": "pdf",
  ".ttf": "font", ".otf": "font", ".woff": "font", ".woff2": "font",
  ".exe": "exe", ".msi": "exe", ".dll": "exe", ".so": "exe", ".dylib": "exe",
  ".png": "image", ".jpg": "image", ".jpeg": "image", ".gif": "image",
  ".svg": "image", ".webp": "image", ".bmp": "image", ".ico": "image",
};

export function getBinaryIconCategory(path: string): BinaryIconCategory {
  const ext = extname(path);
  return BINARY_ICON_MAP[ext] ?? "other";
}

// MIME hint by extension. Used by BinaryPlaceholder to display a hint like
// "application/pdf" without opening the file. Best-effort: extension-driven,
// no magic-byte sniffing. Unknown extensions return `application/octet-stream`.
const MIME_MAP: Record<string, string> = {
  ".zip": "application/zip", ".tar": "application/x-tar", ".gz": "application/gzip",
  ".7z": "application/x-7z-compressed", ".rar": "application/vnd.rar",
  ".pdf": "application/pdf",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg",
  ".flac": "audio/flac", ".m4a": "audio/mp4", ".aac": "audio/aac",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
  ".mkv": "video/x-matroska", ".avi": "video/x-msvideo",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp",
  ".bmp": "image/bmp", ".ico": "image/x-icon",
  ".ttf": "font/ttf", ".otf": "font/otf", ".woff": "font/woff", ".woff2": "font/woff2",
  ".exe": "application/vnd.microsoft.portable-executable",
  ".msi": "application/x-msi", ".dll": "application/octet-stream",
};

export function getMimeHint(path: string): string {
  const ext = extname(path);
  return MIME_MAP[ext] ?? "application/octet-stream";
}

/** Format a byte count in human units (1024-based, like Linux `ls -h`). */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 2 : 1)} ${units[i]}`;
}
