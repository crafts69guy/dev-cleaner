import { LocalStorage } from "@raycast/api";
import { randomUUID } from "node:crypto";

import type { CleanupCandidate, CleanupResult, CleanupRun } from "./types";

const PROJECT_ROOTS_KEY = "project-roots";
const CLEANUP_HISTORY_KEY = "cleanup-history";
const MAX_HISTORY_RUNS = 25;

export async function readProjectRoots(): Promise<string[] | undefined> {
  try {
    const value = await LocalStorage.getItem<string>(PROJECT_ROOTS_KEY);
    if (!value) return undefined;
    const roots: unknown = JSON.parse(value);
    return Array.isArray(roots) && roots.every((root) => typeof root === "string") ? roots : undefined;
  } catch {
    return undefined;
  }
}

export async function writeProjectRoots(roots: string[]): Promise<void> {
  await LocalStorage.setItem(PROJECT_ROOTS_KEY, JSON.stringify([...new Set(roots)]));
}

export async function readCleanupHistory(): Promise<CleanupRun[]> {
  try {
    const value = await LocalStorage.getItem<string>(CLEANUP_HISTORY_KEY);
    if (!value) return [];
    const history: unknown = JSON.parse(value);
    return Array.isArray(history) ? (history as CleanupRun[]) : [];
  } catch {
    return [];
  }
}

export async function recordCleanupRun(
  candidates: CleanupCandidate[],
  results: CleanupResult[],
  startedAt: Date,
  completedAt: Date,
): Promise<CleanupRun> {
  const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const run: CleanupRun = {
    id: `${startedAt.toISOString()}:${randomUUID()}`,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    items: results.map((result) => {
      const candidate = candidatesById.get(result.candidateId);
      return {
        ...result,
        title: candidate?.title ?? result.candidateId,
        providerId: candidate?.providerId ?? "projects",
        cleanupPolicy: candidate?.cleanupPolicy ?? "trash",
      };
    }),
  };
  const history = await readCleanupHistory();
  await LocalStorage.setItem(CLEANUP_HISTORY_KEY, JSON.stringify([run, ...history].slice(0, MAX_HISTORY_RUNS)));
  return run;
}
