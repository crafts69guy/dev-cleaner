import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { XcodeProvider } from "./xcode";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Xcode provider", () => {
  it("lists each DerivedData directory for manual review", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "dev-cleaner-xcode-"));
    temporaryDirectories.push(home);
    const project = path.join(home, "Library/Developer/Xcode/DerivedData/App-hash");
    await mkdir(project, { recursive: true });
    await writeFile(path.join(project, "cache"), "123");

    const result = await new XcodeProvider().scan({ homeDirectory: home, projectRoots: [] });
    expect(result.issues).toEqual([]);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ title: "App-hash", bytes: 3, selectedByDefault: false });
  });

  it("is empty when DerivedData does not exist", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "dev-cleaner-xcode-empty-"));
    temporaryDirectories.push(home);
    await expect(new XcodeProvider().scan({ homeDirectory: home, projectRoots: [] })).resolves.toEqual({
      candidates: [],
      issues: [],
    });
  });
});
