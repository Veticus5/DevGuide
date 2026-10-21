// The version of the code an event happened on. A commit alone is not
// enough: while the agent works, its changes sit uncommitted in the working
// tree, so two events on the same commit can be on different code. The
// working-tree fingerprint hashes the diff against HEAD plus the content of
// every untracked, non-ignored file. Same fingerprint, same code.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

import type { CodeVersion } from "./events.ts";

const GIT_TIMEOUT_MS = 10_000;

export const UNKNOWN_CODE_VERSION: CodeVersion = { commit: null, working_tree: null };

function git(cwd: string, args: string[], input?: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    input,
    stdio: ["pipe", "pipe", "ignore"],
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** Current commit of the repository containing `cwd`, or null outside Git or before the first commit. */
export function readCommit(cwd: string | null): string | null {
  try {
    return git(cwd ?? process.cwd(), ["rev-parse", "HEAD"]).trim() || null;
  } catch {
    return null;
  }
}

/** Fingerprint of the working tree of the repository containing `cwd`, or null when it cannot be computed. */
export function readWorkingTree(cwd: string | null): string | null {
  try {
    return fingerprintWorkingTree(cwd ?? process.cwd());
  } catch {
    return null;
  }
}

/** Commit and working-tree fingerprint of the repository containing `cwd`, or unknown outside Git. */
export function readCodeVersion(cwd: string | null): CodeVersion {
  const commit = readCommit(cwd);
  if (commit === null) return { ...UNKNOWN_CODE_VERSION };
  return { commit, working_tree: readWorkingTree(cwd) };
}

function fingerprintWorkingTree(directory: string): string {
  const hash = createHash("sha256");
  hash.update(git(directory, ["diff", "HEAD", "--no-color", "--no-ext-diff", "--binary"]));
  hash.update("\u0000");
  const untracked = git(directory, ["ls-files", "--others", "--exclude-standard", "-z"])
    .split("\u0000")
    .filter((path) => path.length > 0)
    .sort();
  if (untracked.length > 0) {
    const hashes = git(directory, ["hash-object", "--stdin-paths"], `${untracked.join("\n")}\n`).split("\n");
    untracked.forEach((path, index) => {
      hash.update(`${path}\u0000${hashes[index] ?? ""}\u0000`);
    });
  }
  return hash.digest("hex");
}

export function sameCodeVersion(a: CodeVersion | null | undefined, b: CodeVersion | null | undefined): boolean {
  if (!a || !b) return false;
  if (a.commit === null || b.commit === null) return false;
  return a.commit === b.commit && a.working_tree === b.working_tree;
}
