import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { execSync } from "child_process";
import { join } from "path";
import { tmpdir } from "os";

const TEMP_DIR = join(tmpdir(), "mdr-lint-md-surfaces-test");

describe("check-markdown-surfaces", () => {
  beforeAll(() => {
    rmSync(TEMP_DIR, { recursive: true, force: true });
    mkdirSync(TEMP_DIR, { recursive: true });
  });

  afterAll(() => {
    rmSync(TEMP_DIR, { recursive: true, force: true });
  });

  it("passes when ReactMarkdown is wrapped in allowlisted class with md-wrap-cascade", () => {
    writeFileSync(
      join(TEMP_DIR, "Good.tsx"),
      '<div className="markdown-body md-wrap-cascade">\n  <ReactMarkdown>{content}</ReactMarkdown>\n</div>',
    );
    const result = execSync(
      `node scripts/check-markdown-surfaces.mjs --root "${TEMP_DIR}"`,
      { stdio: "pipe", encoding: "utf8" },
    );
    expect(result).toContain("✅");
  });

  it("passes when ReactMarkdown is wrapped in comment-text class with md-wrap-cascade", () => {
    writeFileSync(
      join(TEMP_DIR, "CommentGood.tsx"),
      '<div className="comment-text md-wrap-cascade"><ReactMarkdown>{text}</ReactMarkdown></div>',
    );
    const result = execSync(
      `node scripts/check-markdown-surfaces.mjs --root "${TEMP_DIR}"`,
      { stdio: "pipe", encoding: "utf8" },
    );
    expect(result).toContain("✅");
  });

  it("fails when ReactMarkdown lacks allowlisted wrapper", () => {
    // Write only a bad file into a fresh temp dir so the good files above
    // don't mask the failure.
    const badDir = join(TEMP_DIR, "bad-only");
    mkdirSync(badDir, { recursive: true });
    writeFileSync(
      join(badDir, "Bad.tsx"),
      '<div className="some-other-class">\n  <ReactMarkdown>{content}</ReactMarkdown>\n</div>',
    );
    try {
      execSync(
        `node scripts/check-markdown-surfaces.mjs --root "${badDir}"`,
        { stdio: "pipe", encoding: "utf8" },
      );
      // Should not reach here
      expect.unreachable("Expected script to exit with non-zero code");
    } catch (err) {
      expect(err.status).not.toBe(0);
      expect(err.stderr.toString()).toContain("ReactMarkdown");
      expect(err.stderr.toString()).toContain("missing overflow-wrap");
    }
  });

  it("fails when ReactMarkdown has no enclosing className at all", () => {
    const bareDir = join(TEMP_DIR, "bare-only");
    mkdirSync(bareDir, { recursive: true });
    writeFileSync(
      join(bareDir, "Bare.tsx"),
      "<div>\n  <ReactMarkdown>{content}</ReactMarkdown>\n</div>",
    );
    try {
      execSync(
        `node scripts/check-markdown-surfaces.mjs --root "${bareDir}"`,
        { stdio: "pipe", encoding: "utf8" },
      );
      expect.unreachable("Expected script to exit with non-zero code");
    } catch (err) {
      expect(err.status).not.toBe(0);
      expect(err.stderr.toString()).toContain("not wrapped by an allowlisted");
    }
  });

  it("fails when wrapper has allowlisted class but missing md-wrap-cascade", () => {
    const noCascadeDir = join(TEMP_DIR, "no-cascade");
    mkdirSync(noCascadeDir, { recursive: true });
    writeFileSync(
      join(noCascadeDir, "NoCascade.tsx"),
      '<div className="markdown-body">\n  <ReactMarkdown>{content}</ReactMarkdown>\n</div>',
    );
    try {
      execSync(
        `node scripts/check-markdown-surfaces.mjs --root "${noCascadeDir}"`,
        { stdio: "pipe", encoding: "utf8" },
      );
      expect.unreachable("Expected script to exit with non-zero code");
    } catch (err) {
      expect(err.status).not.toBe(0);
      expect(err.stderr.toString()).toContain("missing md-wrap-cascade");
    }
  });
});
