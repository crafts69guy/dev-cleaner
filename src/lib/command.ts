import { execFile } from "node:child_process";
import { access, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { CommandSpec } from "../types";

const execFileAsync = promisify(execFile);
const MAX_OUTPUT_BYTES = 64 * 1024;

async function isExecutable(candidate: string): Promise<boolean> {
  try {
    await access(candidate, 1);
    return true;
  } catch {
    return false;
  }
}

async function fnmBinDirectories(homeDirectory: string): Promise<string[]> {
  const versionsRoot = path.join(homeDirectory, ".local/share/fnm/node-versions");
  try {
    const entries = await readdir(versionsRoot, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(versionsRoot, entry.name, "installation/bin"))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

export async function resolveExecutable(
  name: string,
  options: { homeDirectory?: string; extraPath?: string } = {},
): Promise<string | undefined> {
  const homeDirectory = options.homeDirectory ?? os.homedir();
  const pathParts = [
    ...(options.extraPath?.split(path.delimiter) ?? []),
    ...(process.env.PATH?.split(path.delimiter) ?? []),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    path.join(homeDirectory, ".local/bin"),
    path.join(homeDirectory, ".local/share/fnm/aliases/default/bin"),
    ...(await fnmBinDirectories(homeDirectory)),
  ];

  for (const directory of new Set(pathParts.filter(Boolean))) {
    const candidate = path.join(directory, name);
    if (await isExecutable(candidate)) return candidate;
  }
  return undefined;
}

export async function runCommand(spec: CommandSpec, signal?: AbortSignal): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync(spec.executable, spec.args, {
    encoding: "utf8",
    timeout: spec.timeoutMs ?? 120_000,
    maxBuffer: MAX_OUTPUT_BYTES,
    env: { ...process.env, NO_COLOR: "1" },
    signal,
  });
  return { stdout, stderr };
}
