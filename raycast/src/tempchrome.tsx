import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Action, ActionPanel, Icon, List, popToRoot, showToast, Toast } from "@raycast/api";
import { showFailureToast } from "@raycast/utils";
import type { JSX } from "react";
import { launchWithValues } from "./launch";
import LaunchOptionsForm from "./options/LaunchOptionsForm";
import RecentLaunchesList from "./options/RecentLaunchesList";
import { schemaDefaults } from "./options/schema";
import ProfileList from "./profiles/ProfileList";

const execFileAsync = promisify(execFile);

async function handleLaunch(): Promise<void> {
  const toast = await showToast({
    style: Toast.Style.Animated,
    title: "Launching TempChrome…",
  });
  const ok = await launchWithValues(schemaDefaults());
  if (ok) {
    toast.hide();
    await popToRoot({ clearSearchBar: true });
  } else {
    toast.style = Toast.Style.Failure;
    toast.title = "Launch failed";
  }
}

async function handleInstall(): Promise<void> {
  const toast = await showToast({
    style: Toast.Style.Animated,
    title: "Opening Terminal…",
  });
  const activateScript = 'tell application "Terminal" to activate';
  const doScriptScript = 'tell application "Terminal" to do script "tempchrome --install"';
  try {
    await execFileAsync("osascript", ["-e", activateScript, "-e", doScriptScript]);
    toast.style = Toast.Style.Success;
    toast.title = "Terminal opened";
    toast.message = "Running `tempchrome --install`";
  } catch (error) {
    toast.hide();
    await showFailureToast(error, { title: "Could not open Terminal" });
  }
}

export default function Command(): JSX.Element {
  return (
    <List navigationTitle="TempChrome" searchBarPlaceholder="Search actions…">
      <List.Item
        icon={Icon.Rocket}
        title="Launch Now"
        subtitle="Fresh temp profile · default options"
        accessories={[{ text: "↵" }]}
        actions={
          <ActionPanel>
            <Action title="Launch" icon={Icon.Rocket} onAction={handleLaunch} />
          </ActionPanel>
        }
      />
      <List.Item
        icon={Icon.Gear}
        title="Launch with Options…"
        subtitle="Pick flags before launching"
        accessories={[{ tag: "⌘L" }]}
        actions={
          <ActionPanel>
            <Action.Push
              title="Open"
              icon={Icon.Gear}
              shortcut={{ modifiers: ["cmd"], key: "l" }}
              target={<LaunchOptionsForm />}
            />
          </ActionPanel>
        }
      />
      <List.Item
        icon={Icon.Clock}
        title="Recent Launches…"
        subtitle="Replay a recent configured launch"
        accessories={[{ tag: "⌘R" }]}
        actions={
          <ActionPanel>
            <Action.Push
              title="Open"
              icon={Icon.Clock}
              shortcut={{ modifiers: ["cmd"], key: "r" }}
              target={<RecentLaunchesList />}
            />
          </ActionPanel>
        }
      />
      <List.Item
        icon={Icon.Folder}
        title="Manage Temp Profiles…"
        subtitle="List, relaunch, or delete existing temp profiles"
        accessories={[{ tag: "⌘M" }]}
        actions={
          <ActionPanel>
            <Action.Push
              title="Open"
              icon={Icon.Folder}
              shortcut={{ modifiers: ["cmd"], key: "m" }}
              target={<ProfileList />}
            />
          </ActionPanel>
        }
      />
      <List.Item
        icon={Icon.Download}
        title="Install or Update Chromium…"
        subtitle="Runs `tempchrome --install` in Terminal"
        accessories={[{ tag: "⌘I" }]}
        actions={
          <ActionPanel>
            <Action
              title="Open Terminal"
              icon={Icon.Terminal}
              shortcut={{ modifiers: ["cmd"], key: "i" }}
              onAction={handleInstall}
            />
          </ActionPanel>
        }
      />
    </List>
  );
}
