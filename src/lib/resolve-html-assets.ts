import { readBinaryFile, readTextFile } from "@/lib/tauri-commands";
import { dirname, extname } from "@/lib/path-utils";

const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
};

function isLocalPath(src: string): boolean {
  return !src.startsWith("http://") && !src.startsWith("https://") && !src.startsWith("data:") && !src.startsWith("//");
}

function resolvePath(src: string, htmlDir: string): string {
  if (src.startsWith("/") || src.startsWith("\\") || /^[a-zA-Z]:/.test(src)) return src;
  const clean = src.replace(/^\.\//, "");
  return `${htmlDir}/${clean}`;
}

interface Replacement {
  full: string;
  replacement: string;
  index: number;
}

async function resolveImages(html: string, htmlDir: string): Promise<Replacement[]> {
  const srcPattern = /(<img\b[^>]*?\bsrc=")([^"]+)(")/gi;
  const matches: { full: string; prefix: string; src: string; suffix: string; index: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = srcPattern.exec(html)) !== null) {
    if (isLocalPath(m[2])) {
      matches.push({ full: m[0], prefix: m[1], src: m[2], suffix: m[3], index: m.index });
    }
  }

  const results: Replacement[] = [];
  await Promise.all(
    matches.map(async ({ full, prefix, src, suffix, index }) => {
      const absPath = resolvePath(src, htmlDir);
      const mime = MIME_MAP[extname(absPath)] ?? "application/octet-stream";
      try {
        const base64 = await readBinaryFile(absPath);
        results.push({ full, replacement: `${prefix}data:${mime};base64,${base64}${suffix}`, index });
      } catch {
        // keep original on failure
      }
    })
  );

  return results;
}

async function resolveStylesheets(html: string, htmlDir: string): Promise<Replacement[]> {
  const linkPattern = /(<link\b[^>]*?\brel=["']stylesheet["'][^>]*?\bhref=["'])([^"']+)(["'][^>]*?>)/gi;
  const matches: { full: string; prefix: string; href: string; suffix: string; index: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = linkPattern.exec(html)) !== null) {
    if (isLocalPath(m[2])) {
      matches.push({ full: m[0], prefix: m[1], href: m[2], suffix: m[3], index: m.index });
    }
  }

  // Also match href-first pattern: <link href="..." rel="stylesheet">
  const linkPattern2 = /(<link\b[^>]*?\bhref=["'])([^"']+)(["'][^>]*?\brel=["']stylesheet["'][^>]*?>)/gi;
  while ((m = linkPattern2.exec(html)) !== null) {
    if (isLocalPath(m[2])) {
      // Avoid duplicates (same index)
      if (!matches.some((existing) => existing.index === m!.index)) {
        matches.push({ full: m[0], prefix: m[1], href: m[2], suffix: m[3], index: m.index });
      }
    }
  }

  const results: Replacement[] = [];
  await Promise.all(
    matches.map(async ({ full, href, index }) => {
      const absPath = resolvePath(href, htmlDir);
      try {
        const cssContent = await readTextFile(absPath);
        results.push({ full, replacement: `<style>${cssContent}</style>`, index });
      } catch {
        // keep original on failure
      }
    })
  );

  return results;
}

export async function resolveLocalAssets(html: string, htmlFilePath: string): Promise<string> {
  const htmlDir = dirname(htmlFilePath);

  const [imageReplacements, stylesheetReplacements] = await Promise.all([
    resolveImages(html, htmlDir),
    resolveStylesheets(html, htmlDir),
  ]);

  const allReplacements = [...imageReplacements, ...stylesheetReplacements]
    .sort((a, b) => b.index - a.index); // process from end to preserve indices

  let result = html;
  for (const { full, replacement, index } of allReplacements) {
    result = result.slice(0, index) + replacement + result.slice(index + full.length);
  }

  return result;
}
