import { useState, useEffect, useMemo, useDeferredValue } from "react";
import { type BundledLanguage, type Highlighter } from "shiki";
import { getSharedHighlighter } from "@/lib/shiki";
import { getShikiLanguage } from "@/lib/file-types";
import { useTheme } from "@/hooks/useTheme";
import { warn } from "@/logger";
import { requestIdle, cancelIdle, type IdleHandle } from "@/lib/idle";
import {
  SOURCE_HIGHLIGHT_CHUNK_LINES,
  SOURCE_HIGHLIGHT_IDLE_BUDGET_MS,
} from "@/lib/viewer-budgets";
import kqlGrammar from "@/lib/kql.tmLanguage.json";

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const MAX_LOAD_RETRIES = 2;
const RETRY_DELAY_MS = 150;

/**
 * Load a Shiki language grammar with retry. Dynamic imports for grammar
 * files can fail transiently in the Tauri webview (#206), so we retry
 * once after a short delay before falling back to "text".
 */
export async function loadLanguageWithRetry(hl: Highlighter, lang: string): Promise<boolean> {
  for (let attempt = 0; attempt < MAX_LOAD_RETRIES; attempt++) {
    try {
      if (lang === "kql") {
        await hl.loadLanguage({ name: "kql", ...kqlGrammar });
      } else {
        await hl.loadLanguage(lang as BundledLanguage);
      }
    } catch {
      // loadLanguage can throw on invalid/unavailable grammars
    }
    if (hl.getLoadedLanguages().includes(lang)) return true;
    if (attempt < MAX_LOAD_RETRIES - 1) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
  }
  void warn(
    `[shiki] language "${lang}" failed to load after ${MAX_LOAD_RETRIES} attempts — falling back to plain text`
  ); // fire-and-forget log
  return false;
}

/**
 * Split a Shiki `codeToHtml` blob into per-line HTML fragments. Shiki wraps
 * each source line in `<span class="line">…</span>` with nested token spans
 * inside, so we split on the line-span boundary and trim the trailing
 * `</span>` (which closes the line wrapper).
 *
 * Returns an empty array when the blob contains no `<span class="line">`
 * markers — callers fall back to `escapeHtml` per line.
 */
export function splitShikiHtmlByLine(html: string): string[] {
  const parts = html.split('<span class="line">');
  const out: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    // Strip the closing `</span>` that belongs to the line wrapper.
    // Each part ends with `</span>` (line close) possibly followed by
    // `</code></pre>` or more line spans.
    const endIdx = parts[i].lastIndexOf("</span>");
    out.push(endIdx >= 0 ? parts[i].substring(0, endIdx) : parts[i]);
  }
  return out;
}

/**
 * Cheap sample-hash for content fingerprinting. Visits ~1000 evenly-spaced
 * characters, mixes in length, and returns a 32-bit unsigned integer. Used
 * to detect "same length, same path, different content" cases (e.g. a
 * watcher reload that rewrites the file in place) so the chunked Shiki
 * overlay invalidates instead of bleeding stale HTML over new content.
 *
 * Cost: ~30 µs for a 5 MB file. Not cryptographically strong — collisions
 * are theoretically possible but extremely unlikely for the source-text
 * mutation patterns we care about (most edits touch start, end, or length).
 */
export function sampleHash(s: string): number {
  const step = Math.max(1, Math.floor(s.length / 1000));
  let h = 2166136261;
  for (let i = 0; i < s.length; i += step) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  h = Math.imul(h ^ s.length, 16777619);
  return h >>> 0;
}

/**
 * Progressive, idle-chunked Shiki highlighter.
 *
 * **First paint is plain text.** `highlightedLines` is computed by
 * combining `deferredLines` with a per-line Shiki HTML overlay — lines
 * absent from the overlay (and overlays whose fingerprint doesn't match
 * the current content) render as HTML-escaped plain text. The user can
 * read the file immediately while colour fades in chunk-by-chunk via
 * `requestIdleCallback` (polyfilled in `src/lib/idle.ts` for WKWebView).
 *
 * **Why chunked instead of one `codeToHtml` call:** for a 5 MB JS log the
 * single call blocks the main thread for several seconds. Chunked
 * highlighting bounds each `codeToHtml` invocation at
 * `SOURCE_HIGHLIGHT_CHUNK_LINES` (~500 lines, ~10 ms of work) so the main
 * thread keeps frames moving. Multi-line tokens are preserved within a
 * chunk; the worst case is a token straddling the 500-line boundary which
 * is rare and visually minor.
 *
 * **Cancellation:** changes to `path`, `theme`, or `content` (after
 * `useDeferredValue` settles) cancel the in-flight chunk loop. Stale
 * overlays from the previous content are silently invalidated by the
 * fingerprint mismatch in the derived array, so we never paint old Shiki
 * HTML over new content.
 */
export function useSourceHighlighting(content: string, path: string) {
  const deferredContent = useDeferredValue(content);
  const deferredLines = useMemo(() => deferredContent.split("\n"), [deferredContent]);
  const currentTheme = useTheme();

  // Fingerprint identifies the content/path/theme combo this overlay was
  // built for. We include a sample hash of `deferredContent` (visits ~1000
  // chars + length-mix) so a watcher reload that rewrites the file in
  // place — same path, same line count, different content — correctly
  // invalidates the overlay instead of bleeding stale Shiki HTML over the
  // new bytes. The hash is cheap (~30 µs at 5 MB).
  const contentHash = useMemo(() => sampleHash(deferredContent), [deferredContent]);
  const fingerprint = `${path}::${currentTheme}::${deferredLines.length}::${contentHash}`;

  // Per-line Shiki HTML keyed by fingerprint. Held in state so the chunk
  // loop's async updates trigger renders. The derived `highlightedLines`
  // array discards the overlay when its key doesn't match the current
  // fingerprint — that's how stale Shiki HTML stays invisible without
  // ever calling setState synchronously inside an effect body.
  const [overlay, setOverlay] = useState<{
    key: string;
    html: Map<number, string>;
  }>(() => ({ key: "", html: new Map() }));

  useEffect(() => {
    let cancelled = false;
    let idleHandle: IdleHandle | null = null;
    const theme = currentTheme === "dark" ? "github-dark" : "github-light";
    const lang = getShikiLanguage(path);

    void getSharedHighlighter()
      .then(async (hl) => {
        if (cancelled) return;
        let effectiveLang = lang;
        if (!hl.getLoadedLanguages().includes(lang) && lang !== "text") {
          const ok = await loadLanguageWithRetry(hl, lang);
          if (!ok) effectiveLang = "text";
        }
        if (cancelled) return;

        let cursor = 0;
        const total = deferredLines.length;
        const chunkSize = SOURCE_HIGHLIGHT_CHUNK_LINES;
        let working = new Map<number, string>();

        function highlightChunk(start: number, end: number): string[] {
          const chunkText = deferredLines.slice(start, end).join("\n");
          try {
            const html = hl.codeToHtml(chunkText || " ", {
              lang: effectiveLang,
              theme,
            });
            // Empty array → consumer falls back to plain text.
            return splitShikiHtmlByLine(html);
          } catch {
            return [];
          }
        }

        function step(deadline: { timeRemaining(): number }) {
          if (cancelled) return;
          while (
            !cancelled &&
            cursor < total &&
            deadline.timeRemaining() > SOURCE_HIGHLIGHT_IDLE_BUDGET_MS
          ) {
            const start = cursor;
            const end = Math.min(cursor + chunkSize, total);
            const lineHtmls = highlightChunk(start, end);
            if (cancelled) return;
            // Build a new map (React state must be a new reference). The
            // fingerprint stamps which content this overlay belongs to;
            // the derived array discards mismatched overlays.
            working = new Map(working);
            const limit = Math.min(lineHtmls.length, end - start);
            for (let j = 0; j < limit; j++) {
              working.set(start + j, lineHtmls[j]);
            }
            setOverlay({ key: fingerprint, html: working });
            cursor = end;
          }
          if (!cancelled && cursor < total) {
            idleHandle = requestIdle(step);
          }
        }

        idleHandle = requestIdle(step);
      })
      .catch(() => {
        // Highlighter init failed; the derived plain-text fallback is
        // already what's on screen, so nothing further to do here.
      });

    return () => {
      cancelled = true;
      if (idleHandle !== null) cancelIdle(idleHandle);
    };
  }, [deferredContent, deferredLines, path, currentTheme, fingerprint]);

  const highlightedLines = useMemo(() => {
    const valid = overlay.key === fingerprint;
    return deferredLines.map((line, i) =>
      (valid ? overlay.html.get(i) : undefined) ?? escapeHtml(line),
    );
  }, [deferredLines, overlay, fingerprint]);

  return { highlightedLines };
}
