import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const backendRoot = path.resolve(__dirname, "../../..");

/**
 * Spawn a backend worker script (tsx) in a child process.
 * Avoids Windows EINVAL from spawning npx.cmd without a shell.
 */
export function spawnBackendScript(
  scriptRelativePath: string,
  options?: Pick<SpawnOptions, "env">,
): ChildProcess {
  const scriptPath = path.join(backendRoot, scriptRelativePath);
  const tsxCli = path.join(backendRoot, "node_modules", "tsx", "dist", "cli.mjs");

  if (!fs.existsSync(tsxCli)) {
    throw new Error(
      `tsx not found at ${tsxCli}. Run npm install in the backend folder.`,
    );
  }

  const spawnOpts: SpawnOptions = {
    cwd: backendRoot,
    env: {
      ...process.env,
      BACKEND_MANAGED_CHILD: "1",
      ...options?.env,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  };

  if (process.platform === "win32") {
    return spawn(
      process.execPath,
      [tsxCli, scriptPath],
      { ...spawnOpts, shell: false },
    );
  }

  return spawn(process.execPath, [tsxCli, scriptPath], spawnOpts);
}

/** Kill a child process tree on Windows or Unix. */
export function killChildProcess(child: ChildProcess): void {
  if (!child.pid) {
    child.kill();
    return;
  }

  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/f", "/t"], {
      shell: true,
      windowsHide: true,
      stdio: "ignore",
    });
  } else {
    child.kill("SIGTERM");
  }
}
