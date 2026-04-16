import { spawn } from "child_process";
import { execFile } from "child_process";
import { promisify } from "util";
import { randomInt } from "crypto";
import * as fs from "fs";
import * as path from "path";

import {
  BASE_CHROMIUM_ARGS,
  GOOGLE_ENV,
  ID_CHARSET,
  ID_LENGTH,
  MAX_ID_ATTEMPTS,
} from "./constants";

const execFileAsync = promisify(execFile);

export function appBundleFromBinary(binaryPath: string): string {
  const segments = binaryPath.split("/");
  for (let index = segments.length - 1; index >= 0; index--) {
    if (segments[index].endsWith(".app")) {
      return segments.slice(0, index + 1).join("/");
    }
  }
  throw new Error(`No .app bundle segment found in path: ${binaryPath}`);
}

export async function chromiumExists(chromiumPath: string): Promise<boolean> {
  try {
    await fs.promises.access(chromiumPath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function generateProfileId(): string {
  let id = "";
  for (let index = 0; index < ID_LENGTH; index++) {
    id += ID_CHARSET[randomInt(0, ID_CHARSET.length)];
  }
  return id;
}

export async function createTempProfile(tempBaseDir: string): Promise<string> {
  await fs.promises.mkdir(tempBaseDir, { recursive: true, mode: 0o700 });

  for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt++) {
    const id = generateProfileId();
    const candidate = path.join(tempBaseDir, id);
    try {
      await fs.promises.mkdir(candidate, { mode: 0o700 });
      return candidate;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EEXIST") {
        continue;
      }
      throw error;
    }
  }

  throw new Error(`Failed to create unique profile directory after ${MAX_ID_ATTEMPTS} attempts`);
}

export async function clearQuarantine(chromiumPath: string): Promise<void> {
  try {
    const appBundle = appBundleFromBinary(chromiumPath);
    await execFileAsync("xattr", ["-cr", appBundle]);
  } catch (error) {
    console.error("clearQuarantine failed", error);
  }
}

export function launchChromium(
  chromiumPath: string,
  profileDir: string,
  extraArgs: string[],
): void {
  const args = [...BASE_CHROMIUM_ARGS, `--user-data-dir=${profileDir}`, ...extraArgs];
  const env = { ...process.env, ...GOOGLE_ENV };
  const child = spawn(chromiumPath, args, {
    detached: true,
    stdio: "ignore",
    env,
  });
  child.unref();
}
