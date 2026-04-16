import type { JSX } from "react";

import { Action, ActionPanel, Form, showHUD, useNavigation } from "@raycast/api";
import { showFailureToast } from "@raycast/utils";

import { chromiumExists, clearQuarantine, createTempProfile, launchChromium } from "./chromium";
import { getPreferences } from "./preferences";
import { markForAutoCleanup, runSweepFireAndForget } from "./auto-cleanup";

type FormValues = {
  browsingMode: "normal" | "incognito";
  disableWebSecurity: boolean;
  disableExtensions: boolean;
  autoCleanup: boolean;
  customArgs: string;
};

export default function LaunchOptionsForm(): JSX.Element {
  const { pop } = useNavigation();

  async function handleSubmit(values: FormValues): Promise<void> {
    try {
      const extraArgs: string[] = [
        ...(values.browsingMode === "incognito" ? ["--incognito"] : []),
        ...(values.disableWebSecurity ? ["--disable-web-security"] : []),
        ...(values.disableExtensions ? ["--disable-extensions"] : []),
        ...values.customArgs
          .trim()
          .split(/\s+/)
          .filter((token) => token.length > 0),
      ];

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
      launchChromium(prefs.chromiumPath, profileDir, extraArgs);

      if (values.autoCleanup) {
        await markForAutoCleanup(profileDir);
      }

      await showHUD(values.autoCleanup ? "Launched (auto-cleanup enabled)" : "Launched");
      runSweepFireAndForget();
      pop();
    } catch (error) {
      await showFailureToast(error, { title: "Launch failed" });
    }
  }

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Launch" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.Dropdown id="browsingMode" title="Browsing Mode" defaultValue="normal">
        <Form.Dropdown.Item value="normal" title="Normal" />
        <Form.Dropdown.Item value="incognito" title="Incognito" />
      </Form.Dropdown>
      <Form.Separator />
      <Form.Checkbox id="disableWebSecurity" label="Disable Web Security" defaultValue={false} />
      <Form.Checkbox id="disableExtensions" label="Disable Extensions" defaultValue={false} />
      <Form.Separator />
      <Form.Checkbox id="autoCleanup" label="Auto-Cleanup After Close" defaultValue={true} />
      <Form.Separator />
      <Form.TextField
        id="customArgs"
        title="Custom Arguments"
        placeholder="--flag1 --flag2=value"
        defaultValue=""
      />
    </Form>
  );
}
