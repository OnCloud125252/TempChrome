# Performance & Caching

Hard-won patterns for making Raycast extensions feel instant. Read this when the user reports "slow cold start", "UI freezes for a moment", or "tiny delay before data appears".

## Instant Load Pattern (No Empty Flash)

Use a synchronous cache read at module load plus async refresh. The key is `initialData` returning from `getInitialData()` synchronously so React's first paint already has data.

```tsx
import { List, Cache } from "@raycast/api";
import { useCachedPromise, withCache } from "@raycast/utils";

const cache = new Cache();
const CACHE_KEY = "myData";

function getInitialData(): MyData[] {
  const cached = cache.get(CACHE_KEY);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {
      return [];
    }
  }
  return [];
}

const fetchExpensiveData = withCache(
  async () => await someSlowOperation(),
  { maxAge: 5 * 60 * 1000 },
);

async function fetchAllData(): Promise<MyData[]> {
  const data = await fetchExpensiveData();
  cache.set(CACHE_KEY, JSON.stringify(data));
  return data;
}

export default function Command() {
  const { data, isLoading } = useCachedPromise(fetchAllData, [], {
    initialData: getInitialData(),
    keepPreviousData: true,
  });

  return (
    <List isLoading={isLoading && !data?.length}>
      {data?.map((item) => <List.Item key={item.id} title={item.name} />)}
    </List>
  );
}
```

## Key Caching Utilities

| Utility | Purpose |
|---------|---------|
| `Cache` | Persistent disk cache, sync read/write |
| `withCache(fn, {maxAge})` | Wrap async functions with a TTL cache |
| `useCachedPromise` | Stale-while-revalidate render pattern |
| `LocalStorage` | Async key-value storage (persistent user data) |

See also: [references/api/caching.md](api/caching.md) and [references/api/storage.md](api/storage.md).

## Avoiding CLS (Content Layout Shift)

Load all data in a single async function instead of chaining `useEffect` fetches:

```tsx
// BAD - causes layout shift
const [customData, setCustomData] = useState([]);
useEffect(() => {
  loadCustomData().then(setCustomData); // Second render!
}, []);

// GOOD - single fetch, no shift
async function fetchAllData() {
  const [dataA, dataB] = await Promise.all([fetchDataA(), fetchDataB()]);
  return combineData(dataA, dataB);
}
```

## Non-Blocking Operations (Prevent UI Freeze)

**Root cause of "tiny delay"**: sync operations (`execSync`, `statSync`, `readdirSync`) block the event loop during revalidation — the UI freezes even with cached data on screen.

```tsx
// BAD - blocks event loop, UI freezes during revalidation
import { execSync } from "child_process";
import { statSync, readdirSync, copyFileSync } from "fs";

function fetchData() {
  copyFileSync(src, dest);                    // Blocks!
  const result = execSync("sqlite3 query");   // Blocks!
  const entries = readdirSync(dir);           // Blocks!
  for (const entry of entries) {
    statSync(join(dir, entry));               // Blocks N times!
  }
}

// GOOD - fully async, UI renders cached data while refreshing
import { execFile } from "child_process";
import { promisify } from "util";
import { stat, readdir, copyFile, access } from "fs/promises";

const execFileAsync = promisify(execFile);

async function fetchData() {
  await copyFile(src, dest);
  const { stdout } = await execFileAsync("sqlite3", [db, query]);

  // Use withFileTypes to avoid extra stat calls
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => ({ path: join(dir, e.name), name: e.name }));
}
```

**Key optimizations**:
1. Replace `execSync` with async `execFile` (via `promisify`) for shell-free binary calls.
2. Replace `existsSync` with `access()` from `fs/promises`.
3. Replace `readdirSync` + `statSync` loop with `readdir(dir, { withFileTypes: true })`.
4. Run all path validations in parallel with `Promise.all`.
5. Use SQLite URI mode for direct read-only access (no file copy needed).

## SQLite Direct Access (Skip File Copy)

When reading SQLite databases from other apps (Zed, VS Code, etc.), skip the copy with URI mode:

```tsx
// BAD - copies entire database file (slow, blocks)
const tempDb = `/tmp/copy-${Date.now()}.sqlite`;
copyFileSync(originalDb, tempDb);
execSync("sqlite3 " + tempDb + " 'SELECT...'");
unlinkSync(tempDb);

// GOOD - direct read-only access via URI mode
const uri = "file:" + originalDb + "?mode=ro&immutable=1";
const { stdout } = await execFileAsync("sqlite3", [uri, "SELECT ..."]);
```

**URI parameters**:
- `mode=ro` — read-only, no write locks acquired
- `immutable=1` — skip WAL/lock checks, treat file as immutable

## execFile vs exec (Bypass Shell & Injection)

`exec` spawns a shell (~20ms overhead and a command-injection footgun); `execFile` calls the binary directly (~4ms) and takes args as an array so user input is never interpolated into a shell string:

```tsx
// BAD - spawns a shell, parses a command string (injection risk)
import { exec } from "child_process";
const execAsync = promisify(exec);
await execAsync("sqlite3 -separator '|||' " + db + " '" + query + "'");

// GOOD - direct binary execution, ~16ms faster, no shell
import { execFile } from "child_process";
const execFileAsync = promisify(execFile);
await execFileAsync("sqlite3", ["-separator", "|||", db, query]);
```

## Sidecar Pattern (True Background Preloading)

For truly instant cold starts, use a background worker to pre-warm the cache before the user opens the extension.

**Problem**: `view` commands cannot use `interval` (background scheduling). Only `no-view` and `menu-bar` modes support it.

**Solution**: two commands that share the same `Cache`.

```json
// package.json
{
  "commands": [
    { "name": "main", "title": "My Extension", "mode": "view" },
    { "name": "background-sync", "title": "Background Sync", "mode": "no-view", "interval": "15m" }
  ]
}
```

```tsx
// shared-cache.ts - both commands import this
import { Cache } from "@raycast/api";
export const sharedCache = new Cache();

// background-sync.tsx (no-view worker)
import { sharedCache } from "./shared-cache";
export default async function Command() {
  const data = await fetchExpensiveData();
  sharedCache.set("projects", JSON.stringify(data));
}

// main.tsx (view command)
import { sharedCache } from "./shared-cache";
function getInitialData() {
  const cached = sharedCache.get("projects");
  return cached ? JSON.parse(cached) : [];
}
export default function Command() {
  const { data } = useCachedPromise(fetchData, [], {
    initialData: getInitialData(), // Instant from pre-warmed cache!
  });
}
```

- The worker runs silently on interval; the user never sees it.
- Both commands share the same `Cache` (scoped to the extension, not the command).
- Use `15m` to `1h` intervals to avoid battery and rate-limit issues.

## Large Datasets: useSQL over JSON Cache

For >1,000 items, prefer SQLite over a JSON cache so filtering doesn't walk the whole set:

```tsx
// BAD - loads entire 10MB JSON into memory to filter
const allProjects = JSON.parse(cache.get("projects"));
const filtered = allProjects.filter((p) => p.name.includes(query));

// GOOD - SQLite queries only matching rows
import { useSQL } from "@raycast/utils";
const { data } = useSQL(dbPath, "SELECT * FROM projects WHERE name LIKE ?", ["%" + query + "%"]);
```

## Optimistic UI (Instant Actions)

For write operations, update the UI before the API confirms; roll back on failure:

```tsx
const { mutate } = useCachedPromise(fetchItems);

async function deleteItem(id: string) {
  await mutate(deleteItemAPI(id), {
    optimisticUpdate: (current) => current.filter((i) => i.id !== id),
    rollbackOnError: true,
  });
}
```

## Parallel Path Validation

```tsx
// BAD - sequential stat calls
const entries = readdirSync(dir);
for (const entry of entries) {
  const s = statSync(join(dir, entry));  // N blocking calls
}

// GOOD - parallel async checks
const checkPath = async (p: string) => {
  try {
    const s = await stat(p);
    return s.isDirectory() ? p : null;
  } catch {
    return null;
  }
};
const results = await Promise.all(paths.map(checkPath));
```

