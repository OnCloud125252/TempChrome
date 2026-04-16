import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Action, ActionPanel, Icon, List, popToRoot, showHUD } from "@raycast/api";
import { showFailureToast } from "@raycast/utils";
import type { JSX } from "react";

import LaunchOptionsForm from "./LaunchOptionsForm";
import { quickLaunch } from "./launch";
import ProfileList from "./ProfileList";

const execFileAsync = promisify(execFile);

async function handleLaunch(): Promise<void> {
  await quickLaunch();
  await popToRoot({ clearSearchBar: true });
}

async function handleInstall(): Promise<void> {
  const activateScript = 'tell application "Terminal" to activate';
  const doScriptScript = 'tell application "Terminal" to do script "tempchrome --install"';
  try {
    await execFileAsync("osascript", ["-e", activateScript, "-e", doScriptScript]);
    await showHUD("Opening Terminal to install Chromium…");
  } catch (error) {
    await showFailureToast(error, { title: "Could not open Terminal" });
  }
}

export default function Command(): JSX.Element {
  return (
    <List>
      <List.Item
        icon={Icon.Rocket}
        title="Launch Now"
        actions={
          <ActionPanel>
            <Action title="Launch" onAction={handleLaunch} />
          </ActionPanel>
        }
      />
      <List.Item
        icon={Icon.Gear}
        title="Launch with Options…"
        actions={
          <ActionPanel>
            <Action.Push title="Open" target={<LaunchOptionsForm />} />
          </ActionPanel>
        }
      />
      <List.Item
        icon={Icon.Folder}
        title="Manage Temp Profiles…"
        actions={
          <ActionPanel>
            <Action.Push title="Open" target={<ProfileList />} />
          </ActionPanel>
        }
      />
      <List.Item
        icon={Icon.Download}
        title="Install or Update Chromium…"
        actions={
          <ActionPanel>
            <Action title="Open Terminal" onAction={handleInstall} />
          </ActionPanel>
        }
      />
    </List>
  );
}
