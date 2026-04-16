import { getPreferenceValues, showHUD } from "@raycast/api";
import { showFailureToast } from "@raycast/utils";

import {
  chromiumExists,
  clearQuarantine,
  createTempProfile,
  launchChromium,
} from "./chromium/launcher";
import { getPreferences } from "./preferences";
import { buildExtraArgs } from "./options/schema";
import { markForAutoCleanup, runSweepFireAndForget } from "./profiles/autoCleanup";

export async function quickLaunch(): Promise<void> {
  try {
    const preferences = getPreferences();
    const launchPreferences = getPreferenceValues<Preferences.Launch>();

    if (!(await chromiumExists(preferences.chromiumPath))) {
      await showFailureToast(new Error("not found"), {
        title: "Chromium not found",
        message: "Run 'Install or Update Chromium' from the TempChrome command to install it.",
      });
      return;
    }

    const extraArgs = buildExtraArgs(launchPreferences);

    const profileDir = await createTempProfile(preferences.tempBaseDir);
    await clearQuarantine(preferences.chromiumPath);
    launchChromium(preferences.chromiumPath, profileDir, extraArgs);

    if (launchPreferences.autoCleanup) {
      await markForAutoCleanup(profileDir);
    }

    await showHUD(
      launchPreferences.autoCleanup ? "Launched (auto-cleanup enabled)" : "Launched TempChrome",
    );
    runSweepFireAndForget();
  } catch (error) {
    await showFailureToast(error, { title: "Launch failed" });
  }
}

export default async function Command(): Promise<void> {
  await quickLaunch();
}
