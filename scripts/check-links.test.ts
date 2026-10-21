import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";

import { extractLinks, findBrokenLinks } from "./check-links.ts";

const SCRIPT = fileURLToPath(new URL("./check-links.ts", import.meta.url));

describe("extractLinks", () => {
  it("returns relative links with their line numbers", () => {
    const links = extractLinks("intro\n[a](docs/a.md) and [b](../b.md)\n");
    assert.deepEqual(links, [
      { target: "docs/a.md", line: 2 },
      { target: "../b.md", line: 2 },
    ]);
  });

  it("ignores links with a scheme and links to an anchor only", () => {
    const links = extractLinks(
      "[web](https://example.com/x.md) [mail](mailto:someone@example.com) [top](#top) [proto](//cdn/x.md)",
    );
    assert.deepEqual(links, []);
  });

  it("ignores links inside inline code and fenced code blocks", () => {
    const markdown = [
      "Use `[text](missing.md)` syntax.",
      "```md",
      "[fenced](also-missing.md)",
      "```",
      "[real](real.md)",
    ].join("\n");
    assert.deepEqual(extractLinks(markdown), [{ target: "real.md", line: 5 }]);
  });

  it("accepts titles and angle-bracket targets", () => {
    const links = extractLinks('[a](a.md "Title") [b](<b c.md>)');
    assert.deepEqual(links, [
      { target: "a.md", line: 1 },
      { target: "b c.md", line: 1 },
    ]);
  });
});

describe("findBrokenLinks", () => {
  let root: string;

  before(async () => {
    root = await mkdtemp(join(tmpdir(), "check-links-"));
    await mkdir(join(root, "docs"));
    await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
    await writeFile(join(root, "docs", "plan.md"), "# Plan\n\n[back](../README.md#top)\n");
    await writeFile(
      join(root, "README.md"),
      [
        "# Readme",
        "[existing file](docs/plan.md)",
        "[directory](docs/)",
        "[anchor in file](docs/plan.md#section)",
        "[external](https://example.com/nothing.md)",
        "[self anchor](#readme)",
        "[encoded](docs/plan%2Emd)",
        "[missing](docs/nope.md)",
        "[missing dir](nowhere/)",
      ].join("\n"),
    );
    await writeFile(join(root, "node_modules", "pkg", "README.md"), "[ignored](missing.md)\n");
  });

  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("reports only the links whose target does not exist, with source file and target", async () => {
    const broken = await findBrokenLinks(root);
    assert.deepEqual(broken, [
      { file: "README.md", target: "docs/nope.md", line: 8 },
      { file: "README.md", target: "nowhere/", line: 9 },
    ]);
  });

  it("exits with code 1 and prints file -> target when run as a command", () => {
    const result = spawnSync(process.execPath, [SCRIPT, root], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /README\.md:8 -> docs\/nope\.md/);
    assert.match(result.stderr, /2 broken relative link\(s\)/);
  });

  it("exits with code 0 when every link resolves", async () => {
    const cleanRoot = await mkdtemp(join(tmpdir(), "check-links-clean-"));
    try {
      await writeFile(join(cleanRoot, "a.md"), "[b](b.md)\n");
      await writeFile(join(cleanRoot, "b.md"), "[a](a.md)\n");
      const result = spawnSync(process.execPath, [SCRIPT, cleanRoot], { encoding: "utf8" });
      assert.equal(result.status, 0);
      assert.match(result.stdout, /all relative links resolve/);
    } finally {
      await rm(cleanRoot, { recursive: true, force: true });
    }
  });
});
