import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import type { CodeVersion } from "./events.ts";
import type { PreviewModel } from "./preview-model.ts";
import { repoName, startPreviewServer, type PreviewServer } from "./server.ts";
import { appendAgentEvent, startTask } from "./task-log.ts";

const VERSION: CodeVersion = { commit: "a".repeat(40), working_tree: "1".repeat(64) };
const DEPS = { now: () => new Date("2026-10-21T10:00:00.000Z"), codeVersion: () => VERSION };

interface PreviewResponse {
  task: { id: string; description: string } | null;
  repo: string;
  events?: { kind: string }[];
  model?: PreviewModel;
  data_dir?: string;
  pinned: boolean;
}

type Update = { task_id: string | null; version: number };

/** Keeps one SSE connection open until an `update` satisfying `accept` arrives, or the time runs out. */
async function waitForUpdate(url: string, accept: (update: Update) => boolean, timeoutMs: number): Promise<Update | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${url}/api/updates`, { signal: controller.signal });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return null;
      buffer += decoder.decode(value, { stream: true });
      for (const match of buffer.matchAll(/event: update\ndata: (.*)\n\n/g)) {
        const payload = JSON.parse(match[1]!) as Update;
        if (accept(payload)) return payload;
      }
      buffer = buffer.slice(buffer.lastIndexOf("\n\n") + 2);
    }
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

describe("preview server", () => {
  let dir: string;
  let server: PreviewServer | null;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "devguide-server-"));
    server = null;
  });

  afterEach(async () => {
    if (server) await server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("serves the page, the preview data and refuses other paths", async () => {
    startTask(dir, "Export fetches only page one", "s1", VERSION);
    server = await startPreviewServer({ dataDir: dir, port: 0, pollMs: 100 });
    assert.match(server.url, /^http:\/\/localhost:\d+$/);

    const page = await fetch(`${server.url}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type") ?? "", /text\/html/);
    assert.match(await page.text(), /<title>DevGuide - podgląd<\/title>/);

    const css = await fetch(`${server.url}/ui/preview.css`);
    assert.equal(css.status, 200);
    const js = await fetch(`${server.url}/ui/preview.js`);
    assert.match(js.headers.get("content-type") ?? "", /javascript/);

    const preview = (await (await fetch(`${server.url}/api/preview`)).json()) as PreviewResponse;
    assert.equal(preview.task!.description, "Export fetches only page one");
    assert.equal(preview.events!.length, 1);
    assert.equal(preview.model!.header.description, "Export fetches only page one");
    assert.equal(preview.pinned, false);
    assert.equal(preview.repo, basename(dir));
    assert.equal(preview.model!.header.repo, basename(dir));
    assert.equal(repoName("C:\\work\\DevGuide\\.devguide\\experiment"), "DevGuide");
    assert.equal(repoName("/home/x/repo/.devguide"), "repo");
    assert.equal(repoName("/tmp/custom-data"), "custom-data");

    for (const path of ["/ui/../package.json", "/ui/%2e%2e/package.json", "/package.json", "/ui/index.html", "/api/nope"]) {
      assert.equal((await fetch(`${server.url}${path}`)).status, 404, path);
    }
    assert.equal((await fetch(`${server.url}/api/preview`, { method: "POST" })).status, 405);
  });

  it("answers with task: null when there is no task", async () => {
    server = await startPreviewServer({ dataDir: dir, port: 0, pollMs: 100 });
    const preview = (await (await fetch(`${server.url}/api/preview`)).json()) as PreviewResponse;
    assert.equal(preview.task, null);
    assert.equal(preview.data_dir, dir);
  });

  it("sends an update when an event is appended", async () => {
    const task = startTask(dir, "t", "s1", VERSION);
    server = await startPreviewServer({ dataDir: dir, port: 0, pollMs: 100 });
    const first = await waitForUpdate(server.url, (update) => update.task_id === task.record.id, 2000);
    assert.ok(first, "initial update on connect");
    const before = first.version;

    const waiting = waitForUpdate(server.url, (update) => update.version > before, 2000);
    await new Promise((resolve) => setTimeout(resolve, 50));
    appendAgentEvent(task, "hypothesis", { text: "the preview updates" }, DEPS);
    const update = await waiting;
    assert.ok(update && update.version > before, "an update with a newer version arrives after the append");

    const preview = (await (await fetch(`${server.url}/api/preview`)).json()) as PreviewResponse;
    assert.equal(preview.events!.at(-1)!.kind, "hypothesis");
  });

  it("follows a new current task unless pinned", async () => {
    const first = startTask(dir, "first", "s1", VERSION);
    server = await startPreviewServer({ dataDir: dir, port: 0, pollMs: 100 });
    await waitForUpdate(server.url, (update) => update.task_id === first.record.id, 2000);
    const second = startTask(dir, "second", "s2", VERSION, new Date("2026-10-21T11:00:00.000Z"));
    const update = await waitForUpdate(server.url, (update) => update.task_id === second.record.id, 2000);
    assert.ok(update, "update names the new task");
    const preview = (await (await fetch(`${server.url}/api/preview`)).json()) as PreviewResponse;
    assert.equal(preview.task!.id, second.record.id);
    await server.close();

    server = await startPreviewServer({ dataDir: dir, port: 0, pollMs: 100, taskId: first.record.id });
    startTask(dir, "third", "s3", VERSION, new Date("2026-10-21T12:00:00.000Z"));
    await new Promise((resolve) => setTimeout(resolve, 400));
    const pinned = (await (await fetch(`${server.url}/api/preview`)).json()) as PreviewResponse;
    assert.equal(pinned.task!.id, first.record.id);
    assert.equal(pinned.pinned, true);
  });
});
