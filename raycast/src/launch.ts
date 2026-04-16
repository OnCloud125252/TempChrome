import { showHUD } from "@raycast/api";
import { showFailureToast } from "@raycast/utils";

import { chromiumExists, clearQuarantine, createTempProfile, launchChromium } from "./chromium";
import { getPreferences } from "./preferences";
import { runSweepFireAndForget } from "./auto-cleanup";

export async function quickLaunch(): Promise<void> {
  try {
    const prefs = getPreferences();

    if (!(await chromiumExists(prefs.chromiumPath))) {
      await showFailureToast(new Error("not found"), {
        title: "Chromium not found",
        message: "Run 'Install or Update Chromium' from the TempChrome command to install it.",
      });
      return;
    }

    const profileDir = await createTempProfile(prefs.tempBaseDir);
    await clearQuarantine(prefs.chromiumPath);
    launchChromium(prefs.chromiumPath, profileDir, []);
    await showHUD("Launched TempChrome");
    runSweepFireAndForget();
  } catch (error) {
    await showFailureToast(error, { title: "Launch failed" });
  }
}

export default async function Command(): Promise<void> {
  await quickLaunch();
}
