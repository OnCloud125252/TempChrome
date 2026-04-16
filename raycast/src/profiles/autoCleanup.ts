import { LocalStorage } from "@raycast/api";
import { getChromiumProcessArgs, isProfileInUse } from "../chromium/processes";
import { removePath } from "../utils/fs";

const AUTO_CLEANUP_REGISTRY_KEY = "tempchrome.auto-cleanup-registry";

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

let inFlightSweep: Promise<string[]> | null = null;

export async function sweepStaleProfiles(): Promise<string[]> {
  if (inFlightSweep) {
    return inFlightSweep;
  }
  inFlightSweep = performSweep().finally(() => {
    inFlightSweep = null;
  });
  return inFlightSweep;
}

async function performSweep(): Promise<string[]> {
  const registry = await readRegistry();
  const registeredPaths = Object.keys(registry);
  if (registeredPaths.length === 0) {
    return [];
  }

  const psLines = await getChromiumProcessArgs();
  const stalePaths = registeredPaths.filter((candidate) => !isProfileInUse(candidate, psLines));
  const removed: string[] = [];

  for (const stalePath of stalePaths) {
    try {
      await removePath(stalePath);
      delete registry[stalePath];
      removed.push(stalePath);
    } catch (error) {
      console.error("sweepStaleProfiles: failed to remove", stalePath, error);
    }
  }

  await writeRegistry(registry);
  return removed;
}

export function runSweepFireAndForget(): void {
  sweepStaleProfiles().catch((error) => console.error("sweep failed", error));
}
