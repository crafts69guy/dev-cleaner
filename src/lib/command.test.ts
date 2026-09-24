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

  it("passes the additional PATH to child processes", async () => {
    const result = await runCommand({ executable: "/usr/bin/env", args: [] }, undefined, "/custom/tools");
    expect(result.stdout).toContain("PATH=/custom/tools");
  });

  it("keeps only the bounded tail of large command output", async () => {
    const result = await runCommand({
      executable: process.execPath,
      args: ["-e", "process.stdout.write('x'.repeat(70000))"],
    });
    expect(result.stdout).toHaveLength(64 * 1024);
  });

  it("reports non-zero exits, timeouts, and cancellation", async () => {
    await expect(runCommand({ executable: "/bin/sh", args: ["-c", "echo failed >&2; exit 2"] })).rejects.toThrow(
      "failed",
    );
    await expect(runCommand({ executable: "/bin/sh", args: ["-c", "sleep 1"], timeoutMs: 10 })).rejects.toThrow(
      "timed out",
    );

    const controller = new AbortController();
    const running = runCommand({ executable: "/bin/sh", args: ["-c", "sleep 1"] }, controller.signal);
    controller.abort("user cancelled");
    await expect(running).rejects.toMatchObject({ name: "AbortError" });
    await expect(runCommand({ executable: "/definitely/missing/dev-cleaner", args: [] })).rejects.toThrow("ENOENT");
  });
});
