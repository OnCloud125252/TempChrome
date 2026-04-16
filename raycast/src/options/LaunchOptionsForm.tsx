import { Action, ActionPanel, Form, Icon, List, showHUD, useNavigation } from "@raycast/api";
import { showFailureToast } from "@raycast/utils";
import { useEffect, useState, type JSX } from "react";

import {
  chromiumExists,
  clearQuarantine,
  createTempProfile,
  launchChromium,
} from "../chromium/launcher";
import { getPreferences } from "../preferences";
import { markForAutoCleanup, runSweepFireAndForget } from "../profiles/autoCleanup";
import { clearRecent, loadRecent, pushRecent } from "./recentLaunches";
import {
  buildExtraArgs,
  LAUNCH_OPTIONS_SCHEMA,
  schemaDefaults,
  type LaunchOptionsValues,
  type OptionField,
} from "./schema";
import { summarizeValues } from "./summarizeValues";

function renderField(field: OptionField, defaults: LaunchOptionsValues): JSX.Element {
  const lookup = defaults as unknown as Record<string, string | boolean>;

  switch (field.kind) {
    case "dropdown":
      return (
        <Form.Dropdown
          key={field.name}
          id={field.name}
          title={field.title}
          info={field.description}
          defaultValue={(lookup[field.name] as string) ?? field.default}
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
          defaultValue={(lookup[field.name] as boolean) ?? field.default}
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
          defaultValue={(lookup[field.name] as string) ?? field.default}
        />
      );
  }
}

export default function LaunchOptionsForm(): JSX.Element {
  const { pop, push } = useNavigation();
  const [defaults, setDefaults] = useState<LaunchOptionsValues>(() => schemaDefaults());
  const [formKey, setFormKey] = useState(0);

  async function handleSubmit(values: LaunchOptionsValues): Promise<void> {
    try {
      const extraArgs = buildExtraArgs(values);

      const preferences = getPreferences();
      if (!(await chromiumExists(preferences.chromiumPath))) {
        await showFailureToast(new Error("not found"), {
          title: "Chromium not found",
          message: "Run 'Install or Update Chromium' from the TempChrome command to install it.",
        });
        return;
      }

      const profileDir = await createTempProfile(preferences.tempBaseDir);
      await clearQuarantine(preferences.chromiumPath);
      launchChromium(preferences.chromiumPath, profileDir, extraArgs);

      if (values.autoCleanup) {
        await markForAutoCleanup(profileDir);
      }

      await pushRecent(values);

      await showHUD(values.autoCleanup ? "Launched (auto-cleanup enabled)" : "Launched");
      runSweepFireAndForget();
      pop();
    } catch (error) {
      await showFailureToast(error, { title: "Launch failed" });
    }
  }

  function applyRecent(entry: LaunchOptionsValues): void {
    setDefaults(entry);
    setFormKey((current) => current + 1);
    pop();
  }

  return (
    <Form
      key={formKey}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Launch" onSubmit={handleSubmit} />
          <Action
            title="Fill with Recent…"
            icon={Icon.Clock}
            shortcut={{ modifiers: ["cmd"], key: "r" }}
            onAction={() => push(<RecentLaunchesList onPick={applyRecent} />)}
          />
        </ActionPanel>
      }
    >
      {LAUNCH_OPTIONS_SCHEMA.map((field) => renderField(field, defaults))}
    </Form>
  );
}

function RecentLaunchesList(props: { onPick: (values: LaunchOptionsValues) => void }): JSX.Element {
  const [entries, setEntries] = useState<LaunchOptionsValues[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadRecent().then((result) => {
      if (!cancelled) setEntries(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleClear(): Promise<void> {
    await clearRecent();
    setEntries([]);
  }

  return (
    <List
      isLoading={entries === null}
      navigationTitle="Recent Launches"
      searchBarPlaceholder="Filter recent launches"
    >
      {entries !== null && entries.length === 0 && (
        <List.EmptyView
          icon={Icon.Clock}
          title="No recent launches"
          description="Launch from the form once and it will appear here."
        />
      )}
      {entries?.map((entry, index) => (
        <List.Item
          key={index}
          icon={Icon.Clock}
          title={summarizeValues(entry)}
          accessories={[{ text: `#${index + 1}` }]}
          actions={
            <ActionPanel>
              <Action
                title="Use These Settings"
                icon={Icon.Checkmark}
                onAction={() => props.onPick(entry)}
              />
              <Action
                title="Clear All Recent"
                icon={Icon.Trash}
                style={Action.Style.Destructive}
                shortcut={{ modifiers: ["cmd", "shift"], key: "delete" }}
                onAction={handleClear}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
