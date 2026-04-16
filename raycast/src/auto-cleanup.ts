import { LocalStorage } from "@raycast/api";

import { AUTO_CLEANUP_REGISTRY_KEY } from "./constants";
import { getChromiumProcessArgs, isProfileInUse } from "./process-check";
import { trashPath } from "./trash";

export type Registry = Record<string, number>;

export async function readRegistry(): Promise<Registry> {
  const raw = await LocalStorage.getItem<string>(AUTO_CLEANUP_REGISTRY_KEY);
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Registry;
    }
    return {};
  } catch {
    return {};
  }
}

export async function writeRegistry(registry: Registry): Promise<void> {
  await LocalStorage.setItem(AUTO_CLEANUP_REGISTRY_KEY, JSON.stringify(registry));
}

export async function markForAutoCleanup(profilePath: string): Promise<void> {
  const registry = await readRegistry();
  registry[profilePath] = Date.now();
  await writeRegistry(registry);
}

export async function unmarkAutoCleanup(profilePath: string): Promise<void> {
  const registry = await readRegistry();
  if (profilePath in registry) {
    delete registry[profilePath];
    await writeRegistry(registry);
  }
}

export async function sweepStaleProfiles(): Promise<string[]> {
  const registry = await readRegistry();
  const registeredPaths = Object.keys(registry);
  if (registeredPaths.length === 0) {
    return [];
  }

  const psLines = await getChromiumProcessArgs();
  const stalePaths = registeredPaths.filter((candidate) => !isProfileInUse(candidate, psLines));
  const trashed: string[] = [];

  for (const stalePath of stalePaths) {
    try {
      await trashPath(stalePath);
      delete registry[stalePath];
      trashed.push(stalePath);
    } catch (error) {
      console.error("sweepStaleProfiles: failed to trash", stalePath, error);
    }
  }

  await writeRegistry(registry);
  return trashed;
}

export function runSweepFireAndForget(): void {
  sweepStaleProfiles().catch((error) => console.error("sweep failed", error));
}
