import { getPreferenceValues } from "@raycast/api";

export type Preferences = {
  chromiumPath: string;
  tempBaseDir: string;
};

export function getPreferences(): Preferences {
  return getPreferenceValues<Preferences>();
}
