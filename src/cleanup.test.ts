import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { trash } = vi.hoisted(() => ({
  trash: vi.fn<(target: string) => Promise<void>>().mockResolvedValue(undefined),
}));
vi.mock("@raycast/api", () => ({ trash }));

import { cleanCandidate, cleanCandidates } from "./cleanup";
import type { CleanupCandidate } from "./types";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  trash.mockClear();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("cleanup orchestration", () => {
  it("validates and moves project artifacts to Trash", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "dev-cleaner-cleanup-"));
    temporaryDirectories.push(home);
    const root = path.join(home, "projects");
    const artifact = path.join(root, "app/node_modules");
    await mkdir(artifact, { recursive: true });
    const candidate: CleanupCandidate = {
      id: "project:test",
      providerId: "projects",
      section: "Project Artifacts",
      title: "node_modules",
      subtitle: artifact,
      description: "test",
      cleanupPolicy: "trash",
      risk: "review",
      selectedByDefault: false,
      path: artifact,
      bytes: 12,
    };

    await expect(cleanCandidate(candidate, { homeDirectory: home, projectRoots: [root] })).resolves.toMatchObject({
      status: "cleaned",
      bytes: 12,
    });
    expect(trash).toHaveBeenCalledWith(artifact);
  });

  it("reports unsafe paths and missing command specifications", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "dev-cleaner-cleanup-"));
    temporaryDirectories.push(home);
    const base: CleanupCandidate = {
      id: "bad",
      providerId: "projects",
      section: "Project Artifacts",
      title: "bad",
      subtitle: "bad",
      description: "test",
      cleanupPolicy: "trash",
      risk: "review",
      selectedByDefault: false,
      path: home,
    };
    expect((await cleanCandidate(base, { homeDirectory: home, projectRoots: [] })).status).toBe("failed");
    expect(
      (
        await cleanCandidate(
          { ...base, id: "command", cleanupPolicy: "command", path: undefined },
          { homeDirectory: home, projectRoots: [] },
        )
      ).message,
    ).toContain("Missing command");
  });

  it("runs commands sequentially and reports progress", async () => {
    const progress: string[] = [];
    const candidate = (id: string): CleanupCandidate => ({
      id,
      providerId: "npm",
      section: "Package Managers",
      title: id,
      subtitle: id,
      description: "test",
      cleanupPolicy: "command",
      risk: "safe",
      selectedByDefault: true,
      command: { executable: "/bin/echo", args: [id] },
    });
    const results = await cleanCandidates(
      [candidate("one"), candidate("two")],
      { homeDirectory: os.tmpdir(), projectRoots: [] },
      (completed, total) => progress.push(`${completed}/${total}`),
    );
    expect(results.map((result) => result.status)).toEqual(["cleaned", "cleaned"]);
    expect(progress).toEqual(["1/2", "2/2"]);
  });
});
