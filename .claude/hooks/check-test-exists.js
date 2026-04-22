// Warns when a source file in src/lib/ or src/components/ is written without a test file.
import { readFileSync, existsSync } from "fs";
import { dirname, basename, join } from "path";

const raw = readFileSync(0, "utf8");
try {
  const fp = JSON.parse(raw)?.tool_input?.file_path;
  if (!fp) process.exit(0);
  if (!/src[\\/](lib|components)[\\/]/.test(fp)) process.exit(0);
  if (/(__tests__|\.test\.|test-setup|__mocks__)/.test(fp)) process.exit(0);
  if (!/\.(ts|tsx)$/.test(fp)) process.exit(0);

  const dir = dirname(fp);
  const base = basename(fp).replace(/\.tsx?$/, (m) => `.test${m}`);
  const testPath = join(dir, "__tests__", base);

  if (!existsSync(testPath)) {
    process.stderr.write(`⚠  No test file: ${testPath}\n`);
  }
} catch (_) {}
