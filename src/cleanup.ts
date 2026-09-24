import { trash } from "@raycast/api";
import path from "node:path";

import { runCommand } from "./lib/command";
import { assertSafeTrashPath, PROJECT_ARTIFACT_NAMES } from "./lib/path-safety";
import type { CleanupCandidate, CleanupResult, ScanContext } from "./types";

function allowedRoots(candidate: CleanupCandidate, context: ScanContext): string[] {
  if (candidate.providerId === "projects") return context.projectRoots;
  if (candidate.providerId === "xcode") {
    return [path.join(context.homeDirectory, "Library/Developer/Xcode/DerivedData")];
  }
  if (candidate.providerId === "npm") return [path.join(context.homeDirectory, ".npm/_npx")];
  if (candidate.providerId === "claude") {
    return [
      path.join(context.homeDirectory, ".local/share/claude/versions"),
      path.join(context.homeDirectory, ".cache/claude/staging"),
    ];
  }
  return [
    path.join(context.homeDirectory, ".codex/packages/standalone/releases"),
    path.join(context.homeDirectory, ".codex/.tmp"),
  ];
}

export async function cleanCandidate(candidate: CleanupCandidate, context: ScanContext): Promise<CleanupResult> {
  try {
    if (candidate.cleanupPolicy === "command") {
      if (!candidate.command) throw new Error("Missing command specification");
      const result = await runCommand(candidate.command, context.signal);
      return {
        candidateId: candidate.id,
        status: "cleaned",
        bytes: candidate.bytes,
        message: (result.stdout || result.stderr).trim().slice(0, 1_000) || "Command completed",
      };
    }

    if (!candidate.path) throw new Error("Missing cleanup path");
    await assertSafeTrashPath(candidate.path, {
      homeDirectory: context.homeDirectory,
      allowedRoots: allowedRoots(candidate, context),
      expectedNames: candidate.providerId === "projects" ? PROJECT_ARTIFACT_NAMES : undefined,
    });
    await trash(candidate.path);
    return { candidateId: candidate.id, status: "cleaned", bytes: candidate.bytes, message: "Moved to Trash" };
  } catch (error) {
    return { candidateId: candidate.id, status: "failed", message: (error as Error).message };
  }
}

export async function cleanCandidates(
  candidates: CleanupCandidate[],
  context: ScanContext,
  onProgress?: (completed: number, total: number) => void,
): Promise<CleanupResult[]> {
  const results: CleanupResult[] = [];
  for (const candidate of candidates) {
    results.push(await cleanCandidate(candidate, context));
    onProgress?.(results.length, candidates.length);
  }
  return results;
}
