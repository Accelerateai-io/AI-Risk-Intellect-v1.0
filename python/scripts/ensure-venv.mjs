import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const venvDir = join(root, ".venv");
const python =
  process.platform === "win32"
    ? join(venvDir, "Scripts", "python.exe")
    : join(venvDir, "bin", "python");
const pip =
  process.platform === "win32"
    ? join(venvDir, "Scripts", "pip.exe")
    : join(venvDir, "bin", "pip");

function run(command, args, label) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    console.error(`${label} failed`);
    process.exit(result.status ?? 1);
  }
}

if (!existsSync(python)) {
  const launcher = process.platform === "win32" ? "py" : "python3";
  run(launcher, ["-m", "venv", ".venv"], "Creating virtual environment");
}

run(python, ["-m", "pip", "install", "--upgrade", "pip"], "Upgrading pip");
run(pip, ["install", "-r", "requirements.txt"], "Installing Python dependencies");
