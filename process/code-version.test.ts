import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { readCodeVersion, sameCodeVersion } from "./code-version.ts";

function git(cwd: string, ...args: string[]): string {
  const run = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" } });
  assert.equal(run.status, 0, `git ${args.join(" ")}: ${run.stderr}`);
  return run.stdout;
}

/** Creates a repository with one commit containing `tracked.txt` and a `.gitignore`. */
function initRepository(dir: string): string {
  git(dir, "init", "-q");
  writeFileSync(join(dir, "tracked.txt"), "one\n");
  writeFileSync(join(dir, ".gitignore"), "ignored/\n");
  git(dir, "add", ".");
  git(dir, "-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "-m", "init");
  return git(dir, "rev-parse", "HEAD").trim();
}

describe("readCodeVersion", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "devguide-version-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns the commit and a stable fingerprint when nothing changes", () => {
    const head = initRepository(dir);
    const first = readCodeVersion(dir);
    const second = readCodeVersion(dir);
    assert.equal(first.commit, head);
    assert.match(first.working_tree ?? "", /^[0-9a-f]{64}$/);
    assert.deepEqual(first, second);
    assert.equal(sameCodeVersion(first, second), true);
  });

  it("changes the fingerprint when a tracked file is modified, and restores it when reverted", () => {
    initRepository(dir);
    const clean = readCodeVersion(dir);
    writeFileSync(join(dir, "tracked.txt"), "two\n");
    const modified = readCodeVersion(dir);
    assert.equal(modified.commit, clean.commit);
    assert.notEqual(modified.working_tree, clean.working_tree);
    writeFileSync(join(dir, "tracked.txt"), "one\n");
    assert.deepEqual(readCodeVersion(dir), clean);
  });

  it("changes the fingerprint when an untracked file appears or changes", () => {
    initRepository(dir);
    const clean = readCodeVersion(dir);
    writeFileSync(join(dir, "new.txt"), "a\n");
    const added = readCodeVersion(dir);
    assert.notEqual(added.working_tree, clean.working_tree);
    writeFileSync(join(dir, "new.txt"), "b\n");
    const edited = readCodeVersion(dir);
    assert.notEqual(edited.working_tree, added.working_tree);
  });

  it("ignores files that Git ignores", () => {
    initRepository(dir);
    const clean = readCodeVersion(dir);
    const ignored = join(dir, "ignored");
    mkdirSync(ignored);
    writeFileSync(join(ignored, "log.txt"), "noise\n");
    assert.deepEqual(readCodeVersion(dir), clean);
  });

  it("returns unknown outside a repository", () => {
    assert.deepEqual(readCodeVersion(dir), { commit: null, working_tree: null });
    assert.equal(sameCodeVersion(readCodeVersion(dir), readCodeVersion(dir)), false);
  });
});
