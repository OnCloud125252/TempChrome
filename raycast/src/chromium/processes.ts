import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function getChromiumProcessArgs(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("ps", ["-wwAo", "args="]);
    return stdout.split("\n").filter((line) => line.trim().length > 0);
  } catch (error) {
    console.error("getChromiumProcessArgs failed", error);
    return [];
  }
}

export function isProfileInUse(profilePath: string, psLines: string[]): boolean {
  const needle = `--user-data-dir=${profilePath}`;
  return psLines.some((line) => line.includes(needle));
}
