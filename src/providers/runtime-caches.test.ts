import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { RuntimeCachesProvider } from "./runtime-caches";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function executable(file: string, content: string): Promise<void> {
  await writeFile(file, `#!/bin/sh\n${content}\n`);
  await chmod(file, 0o755);
}

describe("runtime and build cache provider", () => {
  it("protects active runtimes and finds regenerable caches", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "dev-cleaner-runtimes-"));
    temporaryDirectories.push(home);
    const bin = path.join(home, "bin");
    await mkdir(bin);
    await executable(
      path.join(bin, "rustup"),
      'if [ "$1" = "show" ]; then echo "stable-aarch64-apple-darwin (default)"; else echo "stable-aarch64-apple-darwin (active, default)"; echo "nightly-aarch64-apple-darwin"; fi',
    );

    const versionsRoot = path.join(home, ".local/share/fnm/node-versions");
    for (const version of ["v16.20.0", "v18.20.0", "v22.16.0", "v24.18.0"]) {
      const installation = path.join(versionsRoot, version, "installation");
      await mkdir(installation, { recursive: true });
      await writeFile(path.join(installation, "node"), version);
    }
    await mkdir(path.join(home, ".local/share/fnm/aliases"), { recursive: true });
    await symlink(
      path.join(versionsRoot, "v24.18.0/installation"),
      path.join(home, ".local/share/fnm/aliases/default"),
    );

    for (const toolchain of ["stable-aarch64-apple-darwin", "nightly-aarch64-apple-darwin"]) {
      const directory = path.join(home, ".rustup/toolchains", toolchain);
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, "rustc"), toolchain);
    }
    for (const cache of [
      ".cargo/registry",
      ".gradle/caches",
      ".gradle/wrapper/dists",
      ".android/cache",
      "Library/Android/sdk/.temp",
    ]) {
      const directory = path.join(home, cache);
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, "item"), cache);
    }

    const result = await new RuntimeCachesProvider().scan({ homeDirectory: home, projectRoots: [], extraPath: bin });
    expect(result.issues).toEqual([]);
    expect(result.candidates).toHaveLength(8);
    expect(result.candidates.every((candidate) => !candidate.selectedByDefault)).toBe(true);
    expect(result.candidates.map((candidate) => candidate.title)).toEqual(
      expect.arrayContaining([
        "Node.js v16.20.0",
        "Node.js v18.20.0",
        "Rust nightly-aarch64-apple-darwin",
        "Cargo registry cache",
        "Gradle caches",
        "Gradle wrapper distributions",
        "Android user cache",
        "Android SDK temporary downloads",
      ]),
    );
    expect(result.candidates.some((candidate) => candidate.title.includes("v22.16.0"))).toBe(false);
    expect(result.candidates.some((candidate) => candidate.title.includes("v24.18.0"))).toBe(false);
    expect(result.candidates.some((candidate) => candidate.title.includes("stable-aarch64"))).toBe(false);
  });

  it("keeps filesystem results when an external tool query fails", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "dev-cleaner-runtimes-failure-"));
    temporaryDirectories.push(home);
    const bin = path.join(home, "bin");
    await mkdir(bin);
    const cargo = path.join(home, ".cargo/registry");
    await mkdir(cargo, { recursive: true });
    await writeFile(path.join(cargo, "item"), "cache");

    const result = await new RuntimeCachesProvider().scan({ homeDirectory: home, projectRoots: [], extraPath: bin });
    expect(result.issues).toEqual([]);
    expect(result.candidates.some((candidate) => candidate.providerId === "cargo")).toBe(true);
  });

  it("protects Node versions pinned by configured projects", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "dev-cleaner-runtime-pins-"));
    temporaryDirectories.push(home);
    const versionsRoot = path.join(home, ".local/share/fnm/node-versions");
    for (const version of ["v18.20.0", "v22.16.0", "v24.18.0"]) {
      const installation = path.join(versionsRoot, version, "installation");
      await mkdir(installation, { recursive: true });
      await writeFile(path.join(installation, "node"), version);
    }
    await mkdir(path.join(home, ".local/share/fnm/aliases"), { recursive: true });
    await symlink(
      path.join(versionsRoot, "v24.18.0/installation"),
      path.join(home, ".local/share/fnm/aliases/default"),
    );
    const project = path.join(home, "project");
    await mkdir(project);
    await writeFile(path.join(project, ".node-version"), "18.20.0\n");

    const result = await new RuntimeCachesProvider().scan({ homeDirectory: home, projectRoots: [project] });

    expect(result.candidates.some((candidate) => candidate.title.includes("v18.20.0"))).toBe(false);
    expect(result.protectedItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "Node.js v18.20.0", reason: expect.stringContaining("Pinned by") }),
      ]),
    );
  });

  it("continues when rustup has no override list", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "dev-cleaner-rustup-overrides-"));
    temporaryDirectories.push(home);
    const bin = path.join(home, "bin");
    await mkdir(bin);
    await executable(
      path.join(bin, "rustup"),
      'if [ "$1" = "override" ]; then exit 1; elif [ "$1" = "show" ]; then echo "stable-aarch64-apple-darwin (default)"; else echo "stable-aarch64-apple-darwin (active, default)"; fi',
    );
    const result = await new RuntimeCachesProvider().scan({ homeDirectory: home, projectRoots: [], extraPath: bin });
    expect(result.issues).toEqual([]);
    expect(result.protectedItems).toEqual(
      expect.arrayContaining([expect.objectContaining({ title: "Rust stable-aarch64-apple-darwin" })]),
    );
  });
});
