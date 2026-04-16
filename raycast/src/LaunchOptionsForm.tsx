import type { JSX } from "react";

import { Action, ActionPanel, Form, showHUD, useNavigation } from "@raycast/api";
import { showFailureToast } from "@raycast/utils";

import { chromiumExists, clearQuarantine, createTempProfile, launchChromium } from "./chromium";
import { getPreferences } from "./preferences";
import {
  LAUNCH_OPTIONS_SCHEMA,
  buildExtraArgs,
  type LaunchOptionsValues,
  type OptionField,
} from "./launchOptionsSchema";
import { markForAutoCleanup, runSweepFireAndForget } from "./auto-cleanup";

function renderField(field: OptionField): JSX.Element {
  switch (field.kind) {
    case "dropdown":
      return (
        <Form.Dropdown
          key={field.name}
          id={field.name}
          title={field.title}
          info={field.description}
          defaultValue={field.default}
        >
          {field.options.map((option) => (
            <Form.Dropdown.Item key={option.value} value={option.value} title={option.title} />
          ))}
        </Form.Dropdown>
      );
    case "checkbox":
      return (
        <Form.Checkbox
          key={field.name}
          id={field.name}
          title={field.title}
          label={field.label}
          info={field.description}
          defaultValue={field.default}
        />
      );
    case "textfield":
      return (
        <Form.TextField
          key={field.name}
          id={field.name}
          title={field.title}
          info={field.description}
          placeholder={field.placeholder}
          defaultValue={field.default}
        />
      );
  }
}

export default function LaunchOptionsForm(): JSX.Element {
  const { pop } = useNavigation();

  async function handleSubmit(values: LaunchOptionsValues): Promise<void> {
    try {
      const extraArgs = buildExtraArgs(values);

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
      {LAUNCH_OPTIONS_SCHEMA.map(renderField)}
    </Form>
  );
}
