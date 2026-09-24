import { chmod, mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { NativeToolsProvider } from "./native-tools";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("native tools provider", () => {
  it("discovers installed tools and stale npx workspaces", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "dev-cleaner-native-"));
    temporaryDirectories.push(home);
    const bin = path.join(home, "bin");
    await mkdir(bin);
    for (const tool of ["npm", "pnpm", "uv", "bun", "brew", "docker"]) {
      const executable = path.join(bin, tool);
      await writeFile(executable, `#!/bin/sh\necho ${tool}-ok\n`);
      await chmod(executable, 0o755);
    }
    const npx = path.join(home, ".npm/_npx/old-workspace");
    await mkdir(npx, { recursive: true });
    await writeFile(path.join(npx, "package.json"), "{}");
    const old = new Date("2026-07-01T00:00:00Z");
    await utimes(npx, old, old);
    await mkdir(path.join(home, ".npm/_cacache"), { recursive: true });
    await writeFile(path.join(home, ".npm/_cacache/item"), "cache");

    const result = await new NativeToolsProvider().scan({
      homeDirectory: home,
      projectRoots: [],
      extraPath: bin,
      now: new Date("2026-09-24T00:00:00Z"),
    });

    expect(result.issues).toEqual([]);
    expect(result.candidates).toHaveLength(8);
    expect(result.candidates.find((candidate) => candidate.id === "npm:npx:old-workspace")).toMatchObject({
      cleanupPolicy: "trash",
      selectedByDefault: true,
    });
    expect(result.candidates.find((candidate) => candidate.providerId === "homebrew")?.description).toContain(
      "Preview:",
    );
    expect(result.candidates.filter((candidate) => candidate.providerId === "docker")).toHaveLength(2);
    expect(
      result.candidates
        .filter((candidate) => candidate.cleanupPolicy === "command")
        .every((candidate) => !candidate.selectedByDefault),
    ).toBe(true);
  });
});
