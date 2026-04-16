import { execFile } from "node:child_process";
import * as fs from "node:fs";
import { promisify } from "node:util";
import { showToast, Toast } from "@raycast/api";

const execFileAsync = promisify(execFile);

let trashMissingToastShown = false;

export async function trashPath(targetPath: string): Promise<void> {
  try {
    await fs.promises.access(targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }

  try {
    await execFileAsync("trash", [targetPath]);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      await fs.promises.rm(targetPath, { recursive: true, force: true });
      if (!trashMissingToastShown) {
        trashMissingToastShown = true;
        await showToast({
          style: Toast.Style.Failure,
          title: "'trash' CLI not found",
          message:
            "Deleting permanently. Install with `brew install trash` for recoverable deletes.",
        });
      }
      return;
    }
    try {
      await fs.promises.access(targetPath);
    } catch (accessError) {
      if ((accessError as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
    }
    throw error;
  }
}
