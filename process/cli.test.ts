import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, it } from "node:test";

import { draftFromOptions } from "./cli.ts";
import type { TaskEvent } from "./events.ts";
import { readEvents, recordHookEvent, startTask } from "./task-log.ts";
import type { TaskSummary } from "./replay.ts";

const SCRIPT = fileURLToPath(new URL("./cli.ts", import.meta.url));
const VERSION = { commit: "a".repeat(40), working_tree: "1".repeat(64) };

describe("cli (as a child process)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "devguide-cli-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function cli(...args: string[]) {
    const run = spawnSync(process.execPath, [SCRIPT, ...args], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, DEVGUIDE_DIR: dir },
    });
    return { status: run.status, stdout: run.stdout, stderr: run.stderr };
  }

  it("record without an open task exits 1 with a message", () => {
    const run = cli("record", "hypothesis", "--text", "x");
    assert.equal(run.status, 1);
    assert.match(run.stderr, /no open task/);
  });

  it("record without a required field exits 1 naming the field", () => {
    startTask(dir, "t", "s", VERSION);
    const run = cli("record", "hypothesis");
    assert.equal(run.status, 1);
    assert.match(run.stderr, /missing required field "text"/);
    assert.equal(cli("replay", "--json").stdout.includes('"hypothesis"'), false);
  });

  it("record with an unknown kind or option exits non-zero", () => {
    startTask(dir, "t", "s", VERSION);
    assert.equal(cli("record", "guess", "--text", "x").status, 1);
    assert.equal(cli("record", "hypothesis", "--bogus", "x").status, 2);
    assert.equal(cli("record").status, 2);
  });

  it("records an observation with a material and replays it as JSON", () => {
    startTask(dir, "Export fetches only page one", "s", VERSION);
    const sample = join(dir, "sample.txt");
    writeFileSync(sample, "rows: 100\n");
    const run = cli("record", "observation", "--text", "Only 100 rows land in the file", "--files", "src/export.ts, src/page.ts", "--material", "expected=rows: 250", "--material-file", `actual=${sample}`);
    assert.equal(run.status, 0, run.stderr);
    const [, kind, id] = run.stdout.trim().split(" ");
    assert.equal(kind, "observation");
    assert.match(id!, /^[0-9a-f]{8}$/);

    const replay = JSON.parse(cli("replay", "--json").stdout) as { events: TaskEvent[]; summary: TaskSummary };
    const event = replay.events.find((item) => item.id === id)!;
    assert.equal(event.kind, "observation");
    assert.equal(event.origin, "agent");
    assert.deepEqual(event.files, ["src/export.ts", "src/page.ts"]);
    assert.deepEqual((event as { materials: unknown }).materials, [
      { label: "expected", content: "rows: 250", nature: "illustration" },
      { label: "actual", content: "rows: 100\n", nature: "illustration" },
    ]);
    assert.equal(replay.summary.counts.events, 2);

    const text = cli("replay").stdout;
    assert.match(text, /Obserwacja: Only 100 rows land in the file \[ilustracje od AI: 2\]/);
    const details = cli("replay", "--event", id!).stdout;
    assert.match(details, /^Obserwacja: /);
    assert.match(details, /\nmaterials:\n/);
  });

  it("records a check as unverified when the command never ran and shows it in status", () => {
    startTask(dir, "t", "s", VERSION);
    const run = cli("record", "check", "--what", "all rows exported", "--expected", "250", "--command", "npm test", "--evidence", "250", "--claimed", "passed");
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /^recorded check [0-9a-f]{8} status=unverified reason=no_execution: no recorded run of exactly this command/);
    const status = cli("status").stdout;
    assert.match(status, /\[niepotwierdzone\] all rows exported/);
    assert.match(status, /powód: brak zarejestrowanego wykonania polecenia/);
    const json = JSON.parse(cli("status", "--json").stdout) as TaskSummary;
    assert.equal(json.checks[0]!.status, "unverified");
    assert.equal(json.checks[0]!.reason, "no_execution");
  });

  it("record change_explained without a title exits 1 naming the field", () => {
    startTask(dir, "t", "s", VERSION);
    const run = cli("record", "change_explained", "--purpose", "p", "--mechanism", "m");
    assert.equal(run.status, 1);
    assert.match(run.stderr, /missing required field "title"/);
    assert.equal(cli("replay", "--json").stdout.includes('"change_explained"'), false);
  });

  it("records an explanation tied to a recorded file change and a check with limits", () => {
    const task = startTask(dir, "t", "s", VERSION);
    const change = recordHookEvent(
      {
        hook_event_name: "PostToolUse",
        session_id: "s",
        cwd: dir,
        tool_name: "Edit",
        tool_input: { file_path: join(dir, "hello.txt"), old_string: "hello", new_string: "greetings" },
        tool_response: { filePath: join(dir, "hello.txt"), oldString: "hello", newString: "greetings", originalFile: "hello\n", structuredPatch: [] },
      },
      dir,
    ).events[0]!;
    const run = cli("record", "change_explained", "--title", "Greeting word", "--purpose", "say greetings", "--mechanism", "replace the word", "--assumptions", "one file", "--files", "hello.txt", "--material", "example=hello -> greetings");
    assert.equal(run.status, 0, run.stderr);
    const id = run.stdout.trim().split(" ")[2]!;
    assert.match(run.stdout, new RegExp(`^recorded change_explained ${id} changes=${change.id}\\n$`));
    const replay = JSON.parse(cli("replay", "--json").stdout) as { events: TaskEvent[]; model: { code: { cards: { id: string; changes: { event_id: string }[] }[] } } };
    const event = replay.events.find((item) => item.id === id) as { change_ids: string[]; assumptions: string };
    assert.deepEqual(event.change_ids, [change.id]);
    assert.equal(event.assumptions, "one file");
    assert.equal(replay.model.code.cards[0]!.changes[0]!.event_id, change.id);
    assert.match(cli("replay").stdout, /Objaśniono poprawkę: Greeting word \(zmiany plików: 1 \[ilustracje od AI: 1\]\)/);

    const check = cli("record", "check", "--what", "w", "--expected", "e", "--command", "npm test", "--evidence", "x", "--claimed", "passed", "--limits", "only a test");
    assert.equal(check.status, 0, check.stderr);
    assert.match(check.stdout, /status=unverified reason=no_execution/);
    const events = JSON.parse(cli("replay", "--json").stdout).events as { kind: string; limits?: string | null }[];
    assert.equal(events.findLast((item) => item.kind === "check")!.limits, "only a test");
    assert.equal(readEvents(task).length, 4);
  });

  it("replay and status without a task exit 0 with a notice", () => {
    const replay = cli("replay");
    assert.equal(replay.status, 0);
    assert.match(replay.stdout, /Brak otwartego zadania/);
    assert.equal(cli("replay", "--json").stdout.trim(), "null");
    assert.equal(cli("status").status, 0);
  });

  it("replay --event with an unknown id exits 1", () => {
    startTask(dir, "t", "s", VERSION);
    const run = cli("replay", "--event", "nope");
    assert.equal(run.status, 1);
    assert.match(run.stderr, /no event with id "nope"/);
  });

  it("--help lists the commands and exits 0", () => {
    const run = cli("--help");
    assert.equal(run.status, 0);
    assert.match(run.stdout, /record <kind>/);
    assert.match(run.stdout, /replay \[--json\]/);
    assert.match(run.stdout, /status/);
    assert.equal(cli().status, 2);
  });
});

describe("draftFromOptions", () => {
  it("maps options to draft fields", () => {
    const draft = draftFromOptions({ hypothesis: "abcd", outcome: "rejected", text: "why", execution: "e1", files: "a, b,", material: ["k=v=w"], changes: "e2, e3", limits: "l" });
    assert.deepEqual(draft, {
      hypothesis_id: "abcd",
      outcome: "rejected",
      text: "why",
      execution_id: "e1",
      limits: "l",
      files: ["a", "b"],
      change_ids: ["e2", "e3"],
      materials: [{ label: "k", content: "v=w", nature: "illustration" }],
    });
  });

  it("rejects a material without a label", () => {
    assert.throws(() => draftFromOptions({ material: ["no label"] }), /--material expects/);
  });
});
