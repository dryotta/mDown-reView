// Native E2E shared helper — workspace tmpdir under the repo's CWD instead
// of `os.tmpdir()`.
//
// Issue #338 / iter-1 forward-fix: on Windows, `os.tmpdir()` resolves under
// `C:\Users\<user>\AppData\Local\Temp\…`. The shipped
// `core::security::system_locations::classify` denies any path matching
// `\AppData\` as Tier::System (rule: tier-3 user-secret roots), which
// `commands::fs::ensure_readable` enforces for every `read_text_file` /
// `read_binary_file`. Tests that wrote fixtures via `os.tmpdir()` therefore
// got their reads rejected with `"path not in workspace"`.
//
// Routing every spec's tmpdir through this helper keeps the test workspace
// outside `\AppData\` (process.cwd() is the repo root, e.g.
// `D:\work\mdownreview`) while still providing a unique, parallelizable
// dir per call. Caller is responsible for `fs.rmSync` cleanup just like
// before.
import * as path from "path";
import * as fs from "fs";

/** Per-repo native test scratch root. Persists across test runs. */
const NATIVE_TMP_ROOT = path.join(process.cwd(), "test-tmp-native");

/**
 * Returns a freshly-created, unique directory under `<repo>/test-tmp-native/`.
 * Suffix is a 8-char base36 random string so parallel Playwright workers and
 * tests started in the same millisecond don't collide.
 */
export function nativeTempDir(prefix: string): string {
  fs.mkdirSync(NATIVE_TMP_ROOT, { recursive: true });
  const suffix = Math.random().toString(36).slice(2, 10);
  const dir = path.join(NATIVE_TMP_ROOT, `${prefix}-${Date.now()}-${suffix}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
