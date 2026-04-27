import { extname, basename } from "@/lib/path-utils";

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
export const SHIKI_LANGUAGE_MAP: Record<string, string> = {
  // Existing entries
  ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
  py: "python", rs: "rust", go: "go", java: "java",
  c: "c", cpp: "cpp", h: "c", css: "css", html: "html",
  json: "json", yaml: "yaml", yml: "yaml", toml: "toml",
  sh: "bash", bash: "bash", md: "markdown", sql: "sql",
  rb: "ruby", php: "php", swift: "swift", kt: "kotlin", cs: "csharp",
  xml: "xml", kql: "kql", csl: "kql",
  // New — languages
  lua: "lua", dart: "dart", scala: "scala", zig: "zig",
  groovy: "groovy", r: "r", ps1: "powershell",
  // New — web/app frameworks
  svelte: "svelte", vue: "vue", astro: "astro",
  graphql: "graphql", gql: "graphql", prisma: "prisma", jsonc: "jsonc",
  // New — infra/config
  tf: "terraform", tfvars: "terraform", hcl: "hcl",
  proto: "protobuf", gradle: "groovy", cmake: "cmake", bicep: "bicep",
  ini: "ini", conf: "ini", env: "ini",
  diff: "diff", patch: "diff",
  // New — Objective-C++; .m deliberately omitted — ambiguous (Objective-C vs MATLAB vs Mathematica)
  mm: "objective-cpp",
};

/** Basename → Shiki language for files without a meaningful extension. */
export const BASENAME_MAP: Record<string, string> = {
  Dockerfile: "docker",
  dockerfile: "docker",
  Containerfile: "docker",
  Makefile: "make",
  GNUmakefile: "make",
  "CMakeLists.txt": "cmake",
};

export function getShikiLanguage(path: string): string {
  const ext = extname(path).slice(1);
  if (ext && SHIKI_LANGUAGE_MAP[ext]) return SHIKI_LANGUAGE_MAP[ext];
  // No extension match — try basename (Dockerfile, Makefile, etc.)
  const base = basename(path);
  return BASENAME_MAP[base] ?? "text";
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
