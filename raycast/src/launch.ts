import * as path from "node:path";
import { getPreferenceValues, showHUD } from "@raycast/api";
import { showFailureToast } from "@raycast/utils";

import {
  chromiumExists,
  clearQuarantine,
  createTempProfile,
  launchChromium,
} from "./chromium/launcher";
import { buildExtraArgs, type LaunchOptionsValues } from "./options/schema";
import { getPreferences } from "./preferences";
import { markForAutoCleanup, runSweepFireAndForget } from "./profiles/autoCleanup";

export async function launchWithValues(values: LaunchOptionsValues): Promise<boolean> {
  try {
    const preferences = getPreferences();

    if (!(await chromiumExists(preferences.chromiumPath))) {
      await showFailureToast(new Error("not found"), {
        title: "Chromium not found",
        message: "Run 'Install or Update Chromium' from the TempChrome command to install it.",
      });
      return false;
    }

    const extraArgs = buildExtraArgs(values);
    const profileDir = await createTempProfile(preferences.tempBaseDir);
    await clearQuarantine(preferences.chromiumPath);
    launchChromium(preferences.chromiumPath, profileDir, extraArgs);

    if (values.autoCleanup) {
      await markForAutoCleanup(profileDir);
    }

    const profileId = path.basename(profileDir);
    const parts = [
      values.autoCleanup ? "Launched" : "Launched (persistent)",
      `profile ${profileId}`,
    ];
    if (extraArgs.length > 0) {
      parts.push(`${extraArgs.length} flag${extraArgs.length === 1 ? "" : "s"}`);
    }
    await showHUD(parts.join(" · "));
    runSweepFireAndForget();
    return true;
  } catch (error) {
    await showFailureToast(error, { title: "Launch failed" });
    return false;
  }
}

export async function quickLaunch(): Promise<boolean> {
  const launchPreferences = getPreferenceValues<Preferences.Launch>() as LaunchOptionsValues;
  return launchWithValues(launchPreferences);
}

export default async function Command(): Promise<void> {
  await quickLaunch();
}
