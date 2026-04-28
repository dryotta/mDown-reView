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
};

// Audio is handled by its own dedicated viewer (AudioViewer) — it doesn't
// share the source/visual toggle, but is listed as "visualizable" so that
// filetype-keyed UI behaviour (toolbar, zoom store) is consistent with
// the other media-only category, image. Zoom is not actually applied to
// audio controls.
const VISUALIZABLE: Set<FileCategory> = new Set([
  "markdown",
  "json",
  "csv",
  "html",
  "mermaid",
  "kql",
  "pdf",
  "audio",
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

// Map file extension → Shiki language id. Covers every language bundled with
// Shiki that has a conventional file extension. The same ids are also accepted
// by the Rust fold-region detector (`src-tauri/src/core/fold_regions.rs`),
// which recognises both `python`/`py` and `yaml`/`yml` for its indent-language
// hint, so this single table serves both syntax highlighting and folding.
export const SHIKI_LANGUAGE_MAP: Record<string, string> = {
  // ── Web / JavaScript ────────────────────────────────────────────────
  ts: "typescript", mts: "typescript", cts: "typescript",
  js: "javascript", mjs: "javascript", cjs: "javascript",
  tsx: "tsx", jsx: "jsx",
  css: "css", scss: "scss", sass: "sass", less: "less", styl: "stylus",
  postcss: "postcss",
  html: "html", htm: "html",
  vue: "vue", svelte: "svelte", astro: "astro",
  pug: "pug", jade: "pug",
  hbs: "handlebars", handlebars: "handlebars",
  erb: "erb", haml: "haml", blade: "blade",
  liquid: "liquid", twig: "twig", edge: "edge",
  mdx: "mdx",
  coffee: "coffee",

  // ── Data / Config ───────────────────────────────────────────────────
  json: "json", jsonc: "jsonc", json5: "json5", jsonl: "jsonl",
  jsonnet: "jsonnet",
  yaml: "yaml", yml: "yaml",
  toml: "toml", ini: "ini", conf: "ini", env: "dotenv",
  xml: "xml", xsl: "xsl", svg: "xml",
  csv: "csv", tsv: "tsv",
  graphql: "graphql", gql: "graphql",
  prisma: "prisma",
  kdl: "kdl", ron: "ron", hjson: "hjson",
  dotenv: "dotenv",

  // ── Systems ─────────────────────────────────────────────────────────
  c: "c", h: "c",
  cpp: "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp", hxx: "cpp", hh: "cpp",
  rs: "rust",
  go: "go",
  zig: "zig",
  nim: "nim",
  v: "v",
  d: "d",
  odin: "odin",

  // ── JVM ─────────────────────────────────────────────────────────────
  java: "java",
  kt: "kotlin", kts: "kotlin",
  scala: "scala",
  groovy: "groovy", gradle: "groovy",
  clj: "clojure", cljs: "clojure", cljc: "clojure", edn: "clojure",

  // ── .NET ────────────────────────────────────────────────────────────
  cs: "csharp",
  fs: "fsharp", fsx: "fsharp", fsi: "fsharp",
  vb: "vb",
  razor: "razor",

  // ── Scripting ───────────────────────────────────────────────────────
  py: "python",
  rb: "ruby",
  php: "php",
  lua: "lua", luau: "luau",
  r: "r",
  jl: "julia",
  pl: "perl", pm: "perl",
  raku: "raku",
  tcl: "tcl",
  awk: "awk",

  // ── Functional ──────────────────────────────────────────────────────
  hs: "haskell",
  ml: "ocaml", mli: "ocaml",
  ex: "elixir", exs: "elixir",
  erl: "erlang", hrl: "erlang",
  elm: "elm",
  gleam: "gleam",
  purescript: "purescript", purs: "purescript",
  rkt: "racket",
  scm: "scheme",

  // ── Mobile / Apple ──────────────────────────────────────────────────
  swift: "swift",
  dart: "dart",
  m: "objective-c",
  mm: "objective-cpp",

  // ── Shell ───────────────────────────────────────────────────────────
  sh: "shellscript", bash: "shellscript", zsh: "shellscript",
  fish: "fish",
  ps1: "powershell",
  bat: "bat", cmd: "bat",
  nu: "nushell",

  // ── Database / Query ────────────────────────────────────────────────
  sql: "sql", plsql: "plsql",
  kql: "kusto", csl: "kusto",

  // ── Infra / DevOps ──────────────────────────────────────────────────
  tf: "terraform", tfvars: "terraform",
  hcl: "hcl",
  proto: "proto",
  cmake: "cmake",
  bicep: "bicep",
  nix: "nix",
  pkl: "pkl",

  // ── Documentation / Markup ──────────────────────────────────────────
  md: "markdown",
  tex: "tex", latex: "latex",
  rst: "rst",
  adoc: "asciidoc",
  typ: "typst",
  wiki: "wikitext",

  // ── Diff / VCS ──────────────────────────────────────────────────────
  diff: "diff", patch: "diff",

  // ── GPU / Shaders ───────────────────────────────────────────────────
  glsl: "glsl", hlsl: "hlsl", wgsl: "wgsl",
  shader: "shaderlab",

  // ── Assembly ────────────────────────────────────────────────────────
  asm: "asm", s: "asm",

  // ── Blockchain / Smart Contracts ────────────────────────────────────
  sol: "solidity",
  vy: "vyper",
  move: "move",

  // ── Game Dev ────────────────────────────────────────────────────────
  gd: "gdscript",
  tscn: "gdresource", tres: "gdresource",

  // ── Other languages ─────────────────────────────────────────────────
  pascal: "pascal", pas: "pascal",
  cobol: "cobol", cob: "cobol",
  fortran: "fortran-free-form", f90: "fortran-free-form", f95: "fortran-free-form",
  f: "fortran-fixed-form", f77: "fortran-fixed-form",
  ada: "ada", adb: "ada", ads: "ada",
  prolog: "prolog",
  hx: "haxe",
  mojo: "mojo",
  wl: "wolfram",
  lean: "lean",
  coq: "coq",
  puppet: "puppet", pp: "puppet",
  sas: "sas",
  stata: "stata", do: "stata",
  sparql: "sparql",
  wasm: "wasm", wat: "wasm",
  reg: "reg",
  log: "log",
  http: "http",
  nginx: "nginx",
};

/** Basename → Shiki language for files without a meaningful extension. */
export const BASENAME_MAP: Record<string, string> = {
  Dockerfile: "docker",
  dockerfile: "docker",
  Containerfile: "docker",
  Makefile: "make",
  makefile: "make",
  GNUmakefile: "make",
  "CMakeLists.txt": "cmake",
  Justfile: "just",
  justfile: "just",
  ".gitignore": "ini",
  ".gitattributes": "ini",
  ".editorconfig": "ini",
  ".env": "dotenv",
  ".env.local": "dotenv",
  ".env.development": "dotenv",
  ".env.production": "dotenv",
  CODEOWNERS: "codeowners",
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
