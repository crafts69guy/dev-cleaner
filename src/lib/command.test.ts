import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resolveExecutable, runCommand } from "./command";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("command helpers", () => {
  it("prefers an explicit additional PATH", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "dev-cleaner-command-"));
    temporaryDirectories.push(home);
    const bin = path.join(home, "bin");
    await mkdir(bin);
    const executable = path.join(bin, "cleaner-test");
    await writeFile(executable, "#!/bin/sh\necho ok\n");
    await chmod(executable, 0o755);

    expect(await resolveExecutable("cleaner-test", { homeDirectory: home, extraPath: bin })).toBe(executable);
    expect(await resolveExecutable("does-not-exist-cleaner", { homeDirectory: home, extraPath: bin })).toBeUndefined();
  });

  it("executes without a shell and captures output", async () => {
    const result = await runCommand({ executable: "/bin/echo", args: ["hello; not-a-command"] });
    expect(result.stdout.trim()).toBe("hello; not-a-command");
    expect(result.stderr).toBe("");
  });
});
