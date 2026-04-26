import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { walk, isTestFile } from "./event-chokepoint.test";

const SRC_ROOT = join(__dirname, "..");

// Forbidden writes targeting `*.review.{yaml,json}` from TS code.
// The Rust commands (add_comment / add_reply / edit_comment / delete_comment /
// update_comment) are the only sanctioned writers via the
// `with_sidecar_or_create` / `mutate_sidecar_or_create` chokepoint.
//
// We catch:
//   - @tauri-apps/plugin-fs writeFile / writeTextFile imports
//   - node:fs(/promises) writeFile* imports
//   - Any literal that would write the .review. extension explicitly.
const FORBIDDEN_FS_IMPORT =
  /from\s+["'](?:@tauri-apps\/plugin-fs|node:fs(?:\/promises)?|fs(?:\/promises)?)["']/;
const FORBIDDEN_REVIEW_LITERAL = /\.review\.(?:yaml|yml|json)/;
const WRITE_FN_REF = /\bwriteText?File\b|\bwriteFileSync\b/;

export function hasForbiddenSidecarWrite(content: string): boolean {
  // Only flag when both an fs-write call AND a `.review.*` literal coexist
  // in the file — keeps the test specific to sidecar mutations and avoids
  // false positives on harmless fs imports (e.g. the meta-tests themselves).
  const writesAReview = WRITE_FN_REF.test(content) && FORBIDDEN_REVIEW_LITERAL.test(content);
  const importsFsAndTouchesReview =
    FORBIDDEN_FS_IMPORT.test(content) && FORBIDDEN_REVIEW_LITERAL.test(content);
  return writesAReview || importsFsAndTouchesReview;
}

describe("no-ts-sidecar-writes architecture rule", () => {
  it("no production TS file writes *.review.{yaml,json} sidecars", () => {
    const offenders: string[] = [];

    for (const file of walk(SRC_ROOT)) {
      if (!/\.(ts|tsx)$/.test(file)) continue;
      const rel = relative(SRC_ROOT, file);
      if (isTestFile(rel)) continue;

      const content = readFileSync(file, "utf8");
      if (hasForbiddenSidecarWrite(content)) {
        offenders.push(rel);
      }
    }

    expect(
      offenders,
      `These files appear to write sidecar files from TypeScript. ` +
        `Route the change through a Rust command (add_comment/edit_comment/...) ` +
        `instead so the with_sidecar_or_create chokepoint stays the only writer:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  describe("hasForbiddenSidecarWrite (matcher self-test)", () => {
    it("flags writeTextFile of a *.review.yaml literal", () => {
      const sample = `
        import { writeTextFile } from "@tauri-apps/plugin-fs";
        await writeTextFile("/p/file.md.review.yaml", "x");
      `;
      expect(hasForbiddenSidecarWrite(sample)).toBe(true);
    });

    it("flags node:fs writeFileSync of a *.review.json literal", () => {
      const sample = `
        import { writeFileSync } from "node:fs";
        writeFileSync("/p/notes.md.review.json", "{}");
      `;
      expect(hasForbiddenSidecarWrite(sample)).toBe(true);
    });

    it("does NOT flag a Rust-command wrapper that mentions sidecar paths in a comment", () => {
      // Only string-literal `.review.*` paths combined with an fs write are
      // forbidden. Wrappers calling invoke('add_comment', ...) are fine.
      const sample = `
        // Saves a comment to the *.review.yaml sidecar via Rust.
        import { invoke } from "@tauri-apps/api/core";
        export const addComment = (filePath: string) =>
          invoke("add_comment", { filePath });
      `;
      expect(hasForbiddenSidecarWrite(sample)).toBe(false);
    });

    it("does NOT flag plugin-fs imports that don't touch *.review.* paths", () => {
      const sample = `
        import { readTextFile } from "@tauri-apps/plugin-fs";
        await readTextFile("/p/notes.md");
      `;
      expect(hasForbiddenSidecarWrite(sample)).toBe(false);
    });
  });
});
