import {
  Action,
  ActionPanel,
  Alert,
  Color,
  confirmAlert,
  Icon,
  List,
  showHUD,
  showToast,
  Toast,
} from "@raycast/api";
import { showFailureToast, usePromise } from "@raycast/utils";
import { type JSX, useEffect } from "react";
import { readRegistry, sweepStaleProfiles, unmarkAutoCleanup, writeRegistry } from "./auto-cleanup";
import { chromiumExists, clearQuarantine, launchChromium } from "./chromium";
import { quickLaunch } from "./launch";
import { getPreferences } from "./preferences";
import { formatBytes, listProfiles, type ProfileInfo } from "./profiles";
import { trashPath } from "./trash";

export default function ProfileList(): JSX.Element {
  const preferences = getPreferences();
  const { data, isLoading, revalidate } = usePromise(
    async () => listProfiles(preferences.tempBaseDir),
    [],
  );

  useEffect(() => {
    sweepStaleProfiles()
      .then((trashed) => {
        if (trashed.length > 0) {
          revalidate();
        }
      })
      .catch((error) => console.error("mount sweep failed", error));
  }, [revalidate]);

  async function handleRelaunch(profile: ProfileInfo): Promise<void> {
    try {
      if (!(await chromiumExists(preferences.chromiumPath))) {
        await showFailureToast(new Error("not found"), {
          title: "Chromium not found",
          message: "Run 'Install or Update Chromium' from the TempChrome command to install it.",
        });
        return;
      }
      await clearQuarantine(preferences.chromiumPath);
      launchChromium(preferences.chromiumPath, profile.path, []);
      await showHUD(`Launched with profile ${profile.id}`);
      const trashed = await sweepStaleProfiles();
      if (trashed.length > 0) {
        revalidate();
      }
    } catch (error) {
      await showFailureToast(error, { title: "Launch failed" });
    }
  }

  async function handleDelete(profile: ProfileInfo): Promise<void> {
    const title = profile.inUse ? "Delete profile in use?" : "Delete profile?";
    const message = profile.inUse
      ? `${profile.id} (${formatBytes(profile.size)}) is currently in use by Chromium. Deleting it may corrupt the running session. Continue?`
      : `${profile.id} (${formatBytes(profile.size)}) will be moved to Trash.`;
    const primaryTitle = profile.inUse ? "Delete Anyway" : "Delete";

    const confirmed = await confirmAlert({
      title,
      message,
      primaryAction: {
        title: primaryTitle,
        style: Alert.ActionStyle.Destructive,
      },
    });
    if (!confirmed) {
      return;
    }

    try {
      await trashPath(profile.path);
      await unmarkAutoCleanup(profile.path);
      revalidate();
    } catch (error) {
      await showFailureToast(error, { title: "Delete failed" });
    }
  }

  async function handleDeleteAll(profiles: ProfileInfo[]): Promise<void> {
    const idle = profiles.filter((profile) => !profile.inUse);
    const inUse = profiles.length - idle.length;
    const totalSize = idle.reduce((sum, profile) => sum + profile.size, 0);

    if (idle.length === 0) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Nothing to delete",
        message: profiles.length === 0 ? "No profiles found." : "All profiles are in use.",
      });
      return;
    }

    const confirmed = await confirmAlert({
      title: `Delete ${idle.length} idle profile(s)?`,
      message:
        `Total ${formatBytes(totalSize)} will be moved to Trash.` +
        (inUse > 0 ? ` ${inUse} in-use profile(s) will be skipped.` : ""),
      primaryAction: {
        title: `Delete ${idle.length}`,
        style: Alert.ActionStyle.Destructive,
      },
    });
    if (!confirmed) {
      return;
    }

    try {
      await Promise.all(idle.map((profile) => trashPath(profile.path)));
      const registry = await readRegistry();
      let mutated = false;
      for (const profile of idle) {
        if (profile.path in registry) {
          delete registry[profile.path];
          mutated = true;
        }
      }
      if (mutated) {
        await writeRegistry(registry);
      }

      await showToast({
        style: Toast.Style.Success,
        title: `Deleted ${idle.length} profile(s)`,
        ...(inUse > 0 ? { message: `${inUse} skipped (in use)` } : {}),
      });
      revalidate();
    } catch (error) {
      await showFailureToast(error, { title: "Delete failed" });
    }
  }

  async function handleCleanupStale(): Promise<void> {
    try {
      const cleaned = await sweepStaleProfiles();
      if (cleaned.length === 0) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Nothing to clean up",
          message: "No stale auto-cleanup profiles found.",
        });
      } else {
        await showToast({
          style: Toast.Style.Success,
          title: `Cleaned up ${cleaned.length} stale profile(s)`,
        });
      }
      revalidate();
    } catch (error) {
      await showFailureToast(error, { title: "Cleanup failed" });
    }
  }

  const profiles = data ?? [];

  return (
    <List isLoading={isLoading}>
      {!isLoading && profiles.length === 0 ? (
        <List.EmptyView
          title="No temporary profiles found"
          description="Launch TempChrome to create one."
          actions={
            <ActionPanel>
              <Action
                // eslint-disable-next-line @raycast/prefer-title-case
                title="Launch TempChrome"
                icon={Icon.Rocket}
                onAction={async () => {
                  await quickLaunch();
                  revalidate();
                }}
              />
            </ActionPanel>
          }
        />
      ) : (
        profiles.map((profile) => (
          <List.Item
            key={profile.id}
            title={profile.id}
            subtitle={formatBytes(profile.size)}
            accessories={[
              ...(profile.autoCleanup
                ? [
                    {
                      tag: {
                        value: profile.inUse ? "Cleans on exit" : "Pending cleanup",
                        color: profile.inUse ? Color.Blue : Color.Orange,
                      },
                      tooltip: profile.inUse
                        ? "This profile will be moved to Trash after Chromium exits."
                        : "Chromium has exited; this profile will be removed on the next sweep.",
                    },
                  ]
                : []),
              profile.inUse
                ? {
                    tag: { value: "In use", color: Color.Green },
                    icon: Icon.CircleFilled,
                  }
                : { tag: { value: "Idle", color: Color.SecondaryText } },
              { date: profile.createdAt },
            ]}
            actions={
              <ActionPanel>
                <Action
                  title="Launch with This Profile"
                  icon={Icon.Rocket}
                  onAction={() => handleRelaunch(profile)}
                />
                <Action.ShowInFinder path={profile.path} />
                <Action.CopyToClipboard title="Copy Path" content={profile.path} />
                <Action
                  title="Delete Profile"
                  icon={Icon.Trash}
                  style={Action.Style.Destructive}
                  shortcut={{ modifiers: ["ctrl"], key: "x" }}
                  onAction={() => handleDelete(profile)}
                />
                <Action
                  title="Delete All Idle Profiles"
                  icon={Icon.Trash}
                  style={Action.Style.Destructive}
                  shortcut={{ modifiers: ["cmd", "shift"], key: "backspace" }}
                  onAction={() => handleDeleteAll(profiles)}
                />
                <Action
                  // eslint-disable-next-line @raycast/prefer-title-case
                  title="Clean Up Stale Profiles"
                  icon={Icon.Hammer}
                  onAction={handleCleanupStale}
                />
              </ActionPanel>
            }
          />
        ))
      )}
    </List>
  );
}
