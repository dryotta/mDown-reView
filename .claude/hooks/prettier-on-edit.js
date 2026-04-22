// Runs prettier on the edited file after Write/Edit tool calls.
import { execSync } from "child_process";
import { readFileSync } from "fs";

const raw = readFileSync(0, "utf8");
try {
  const fp = JSON.parse(raw)?.tool_input?.file_path;
  if (fp && /\.(ts|tsx|js|jsx|css)$/.test(fp)) {
    execSync(`npx prettier --write ${JSON.stringify(fp)}`, {
      stdio: "inherit",
      shell: true,
    });
  }
} catch (_) {}
