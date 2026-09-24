import { opendir, realpath } from "node:fs/promises";
import path from "node:path";

import { mapWithConcurrency } from "../lib/async";
import { resolveExecutable, runCommand } from "../lib/command";
import { directorySize, modifiedAt, pathExists } from "../lib/fs";
import type { CleanupCandidate, CleanupProvider, ProviderId, ScanContext, ScanResult } from "../types";
import { compareVersionNames } from "./ai-tools";

interface TrashCandidateInput {
  providerId: ProviderId;
  section: string;
  title: string;
  path: string;
  description: string;
  risk: "safe" | "review" | "high";
}

async function createTrashCandidate(
  input: TrashCandidateInput,
  signal?: AbortSignal,
): Promise<CleanupCandidate | undefined> {
  signal?.throwIfAborted();
  if (!(await pathExists(input.path))) return undefined;
  const bytes = await directorySize(input.path, signal);
  if (bytes === 0) return undefined;
  return {
    id: `${input.providerId}:runtime:${input.path}`,
    providerId: input.providerId,
    section: input.section,
    title: input.title,
    subtitle: input.path,
    description: input.description,
    cleanupPolicy: "trash",
    risk: input.risk,
    selectedByDefault: false,
    bytes,
    modifiedAt: await modifiedAt(input.path),
    path: input.path,
  };
}

async function scanPnpmStores(context: ScanContext): Promise<CleanupCandidate[]> {
  const executable = await resolveExecutable("pnpm", context);
  const storeRoot = path.join(context.homeDirectory, "Library/pnpm/store");
  if (!executable || !(await pathExists(storeRoot))) return [];
  const { stdout } = await runCommand({ executable, args: ["--version"], timeoutMs: 10_000 }, context.signal);
  const activeMajor = Number.parseInt(stdout.trim().split(".")[0], 10);
  if (!Number.isFinite(activeMajor)) throw new Error(`Could not determine pnpm major version from ${stdout.trim()}`);

  const directory = await opendir(storeRoot);
  const stores: TrashCandidateInput[] = [];
  for await (const entry of directory) {
    context.signal?.throwIfAborted();
    const match = /^v(\d+)$/.exec(entry.name);
    if (!entry.isDirectory() || !match || Number(match[1]) >= activeMajor) continue;
    stores.push({
      providerId: "pnpm",
      section: "Runtime Versions",
      title: `pnpm store ${entry.name}`,
      path: path.join(storeRoot, entry.name),
      description: `Store format ${entry.name} predates the active pnpm ${activeMajor}. Review projects using older pnpm versions before removal.`,
      risk: "review",
    });
  }
  const candidates = await mapWithConcurrency(
    stores,
    3,
    (store) => createTrashCandidate(store, context.signal),
    context.signal,
  );
  return candidates.filter((candidate): candidate is CleanupCandidate => candidate !== undefined);
}

async function scanFnmVersions(context: ScanContext): Promise<CleanupCandidate[]> {
  const versionsRoot = path.join(context.homeDirectory, ".local/share/fnm/node-versions");
  if (!(await pathExists(versionsRoot))) return [];
  const directory = await opendir(versionsRoot);
  const versions: { name: string; path: string }[] = [];
  for await (const entry of directory) {
    context.signal?.throwIfAborted();
    if (entry.isDirectory() && /^v\d/.test(entry.name)) {
      versions.push({ name: entry.name, path: path.join(versionsRoot, entry.name) });
    }
  }
  versions.sort((left, right) => compareVersionNames(right.name, left.name));

  let currentName: string | undefined;
  const defaultAlias = path.join(context.homeDirectory, ".local/share/fnm/aliases/default");
  if (await pathExists(defaultAlias)) {
    const target = await realpath(defaultAlias);
    currentName = path.basename(path.dirname(target));
  }
  const protectedNames = new Set<string>();
  if (currentName) protectedNames.add(currentName);
  const rollback = versions.find((version) => version.name !== currentName);
  if (rollback) protectedNames.add(rollback.name);

  const candidates = await mapWithConcurrency(
    versions.filter((version) => !protectedNames.has(version.name)),
    3,
    (version) =>
      createTrashCandidate(
        {
          providerId: "node",
          section: "Runtime Versions",
          title: `Node.js ${version.name}`,
          path: version.path,
          description:
            "An older fnm-managed Node.js version. The default version and one rollback version are protected.",
          risk: "review",
        },
        context.signal,
      ),
    context.signal,
  );
  return candidates.filter((candidate): candidate is CleanupCandidate => candidate !== undefined);
}

async function scanRustToolchains(context: ScanContext): Promise<CleanupCandidate[]> {
  const executable = await resolveExecutable("rustup", context);
  if (!executable) return [];
  const [activeResult, listResult] = await Promise.all([
    runCommand({ executable, args: ["show", "active-toolchain"], timeoutMs: 10_000 }, context.signal),
    runCommand({ executable, args: ["toolchain", "list"], timeoutMs: 10_000 }, context.signal),
  ]);
  const active = activeResult.stdout.trim().split(/\s+/)[0];
  const toolchains = listResult.stdout
    .split("\n")
    .map((line) => line.trim().split(/\s+/)[0])
    .filter(Boolean);

  return Promise.all(
    toolchains
      .filter((toolchain) => toolchain !== active)
      .map(async (toolchain): Promise<CleanupCandidate> => {
        const toolchainPath = path.join(context.homeDirectory, ".rustup/toolchains", toolchain);
        return {
          id: `rustup:toolchain:${toolchain}`,
          providerId: "rustup",
          section: "Runtime Versions",
          title: `Rust ${toolchain}`,
          subtitle: `${executable} toolchain uninstall ${toolchain}`,
          description: `Inactive Rust toolchain. The active toolchain ${active || "could not be named"} is protected.`,
          cleanupPolicy: "command",
          risk: "review",
          selectedByDefault: false,
          bytes: (await pathExists(toolchainPath)) ? await directorySize(toolchainPath, context.signal) : undefined,
          path: (await pathExists(toolchainPath)) ? toolchainPath : undefined,
          command: { executable, args: ["toolchain", "uninstall", toolchain], timeoutMs: 300_000 },
        };
      }),
  );
}

async function scanRegenerableCaches(context: ScanContext): Promise<CleanupCandidate[]> {
  const home = context.homeDirectory;
  const inputs: TrashCandidateInput[] = [
    {
      providerId: "cargo",
      section: "Build and Package Caches",
      title: "Cargo registry cache",
      path: path.join(home, ".cargo/registry"),
      description: "Downloaded crates and unpacked sources. Cargo will download them again when needed.",
      risk: "review",
    },
    {
      providerId: "cargo",
      section: "Build and Package Caches",
      title: "Cargo Git cache",
      path: path.join(home, ".cargo/git"),
      description: "Git dependencies cached by Cargo. Cargo will clone them again when needed.",
      risk: "review",
    },
    {
      providerId: "gradle",
      section: "Build and Package Caches",
      title: "Gradle caches",
      path: path.join(home, ".gradle/caches"),
      description: "Regenerable Gradle dependency and build caches. Close Gradle builds and IDEs before cleanup.",
      risk: "high",
    },
    {
      providerId: "gradle",
      section: "Build and Package Caches",
      title: "Gradle wrapper distributions",
      path: path.join(home, ".gradle/wrapper/dists"),
      description: "Downloaded Gradle distributions. Project wrappers will download required versions again.",
      risk: "review",
    },
    {
      providerId: "android",
      section: "Build and Package Caches",
      title: "Android user cache",
      path: path.join(home, ".android/cache"),
      description: "Regenerable Android tooling cache. AVD definitions and SDK packages are not included.",
      risk: "review",
    },
    {
      providerId: "android",
      section: "Build and Package Caches",
      title: "Android SDK temporary downloads",
      path: path.join(home, "Library/Android/sdk/.temp"),
      description:
        "Incomplete or temporary Android SDK downloads. Installed SDK packages and system images are protected.",
      risk: "safe",
    },
  ];
  const candidates = await mapWithConcurrency(
    inputs,
    3,
    (input) => createTrashCandidate(input, context.signal),
    context.signal,
  );
  return candidates.filter((candidate): candidate is CleanupCandidate => candidate !== undefined);
}

export class RuntimeCachesProvider implements CleanupProvider {
  readonly id = "node" as const;

  async scan(context: ScanContext): Promise<ScanResult> {
    const sources: { providerId: ProviderId; scan: () => Promise<CleanupCandidate[]> }[] = [
      { providerId: "pnpm", scan: () => scanPnpmStores(context) },
      { providerId: "node", scan: () => scanFnmVersions(context) },
      { providerId: "rustup", scan: () => scanRustToolchains(context) },
      { providerId: "cargo", scan: () => scanRegenerableCaches(context) },
    ];
    const results = await Promise.allSettled(sources.map((source) => source.scan()));
    context.signal?.throwIfAborted();
    return {
      candidates: results.flatMap((result) => (result.status === "fulfilled" ? result.value : [])),
      issues: results.flatMap((result, index) =>
        result.status === "rejected"
          ? [{ providerId: sources[index].providerId, message: (result.reason as Error).message }]
          : [],
      ),
    };
  }
}
