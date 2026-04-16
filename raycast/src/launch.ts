import { getPreferenceValues, showHUD } from "@raycast/api";
import { showFailureToast } from "@raycast/utils";

import { chromiumExists, clearQuarantine, createTempProfile, launchChromium } from "./chromium";
import { getPreferences } from "./preferences";
import { buildExtraArgs } from "./launchOptionsSchema";
import { markForAutoCleanup, runSweepFireAndForget } from "./auto-cleanup";

export async function quickLaunch(): Promise<void> {
  try {
    const prefs = getPreferences();
    const launchPrefs = getPreferenceValues<Preferences.Launch>();

    if (!(await chromiumExists(prefs.chromiumPath))) {
      await showFailureToast(new Error("not found"), {
        title: "Chromium not found",
        message: "Run 'Install or Update Chromium' from the TempChrome command to install it.",
      });
      return;
    }

    const extraArgs = buildExtraArgs(launchPrefs);

    const profileDir = await createTempProfile(prefs.tempBaseDir);
    await clearQuarantine(prefs.chromiumPath);
    launchChromium(prefs.chromiumPath, profileDir, extraArgs);

    if (launchPrefs.autoCleanup) {
      await markForAutoCleanup(profileDir);
    }

    await showHUD(
      launchPrefs.autoCleanup ? "Launched (auto-cleanup enabled)" : "Launched TempChrome",
    );
    runSweepFireAndForget();
  } catch (error) {
    await showFailureToast(error, { title: "Launch failed" });
  }
}

export default async function Command(): Promise<void> {
  await quickLaunch();
}
