import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { runCommand } = vi.hoisted(() => ({ runCommand: vi.fn() }));
vi.mock("../lib/command", () => ({
  resolveExecutable: vi.fn(async () => undefined),
  runCommand,
}));

import { NativeToolsProvider } from "./native-tools";
import { RuntimeCachesProvider } from "./runtime-caches";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  runCommand.mockClear();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("providers without installed tools", () => {
  it("skip native commands and Rust toolchains without running anything", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "dev-cleaner-missing-tools-"));
    temporaryDirectories.push(home);

    await expect(new NativeToolsProvider().scan({ homeDirectory: home, projectRoots: [] })).resolves.toEqual({
      candidates: [],
      issues: [],
    });
    await expect(new RuntimeCachesProvider().scan({ homeDirectory: home, projectRoots: [] })).resolves.toEqual({
      candidates: [],
      issues: [],
      protectedItems: [],
    });
    expect(runCommand).not.toHaveBeenCalled();
  });
});
