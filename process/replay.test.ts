import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CodeVersion, TaskEvent } from "./events.ts";
import { describeEvent, formatEvent, formatSummary, formatTimeline, sessionContext, summarize } from "./replay.ts";
import type { TaskRecord } from "./task-log.ts";

const TASK: TaskRecord = { id: "20261021-1000-ab12", description: "Export fetches only page one", started: "2026-10-21T10:00:00.000Z", session_ids: ["s1"] };
const V1: CodeVersion = { commit: "c".repeat(40), working_tree: "1".repeat(64) };
const V2: CodeVersion = { commit: "c".repeat(40), working_tree: "2".repeat(64) };

let counter = 0;
function event<K extends TaskEvent["kind"]>(kind: K, fields: Omit<Extract<TaskEvent, { kind: K }>, keyof TaskEventBase | "kind"> & Partial<TaskEventBase>): Extract<TaskEvent, { kind: K }> {
  counter += 1;
  const base: TaskEventBase = {
    id: `e${counter}`,
    time: `2026-10-21T10:${String(counter).padStart(2, "0")}:00.000Z`,
    task_id: TASK.id,
    session_id: "s1",
    code_version: V1,
    files: [],
  };
  return { kind, ...base, ...fields } as unknown as Extract<TaskEvent, { kind: K }>;
}
type TaskEventBase = Omit<TaskEvent, "kind" | "origin"> extends infer B ? Omit<B, never> : never;

function course(): TaskEvent[] {
  const started = event("task_started", { origin: "user", description: TASK.description });
  const observation = event("observation", { origin: "agent", text: "Only 100 of 250 rows land in the file", materials: [{ label: "sample", content: "rows: 100", nature: "illustration" }] });
  const hypothesis = event("hypothesis", { origin: "agent", text: "the page parameter is ignored" });
  const rejected = event("hypothesis_resolved", { origin: "agent", hypothesis_id: hypothesis.id, outcome: "rejected", text: "the parameter is passed correctly" });
  const second = event("hypothesis", { origin: "agent", text: "the loop stops after the first page" });
  const run = event("command_run", { origin: "tool", command: "npm test", stdout: "250 records written\n", stderr: "", interrupted: false, exit_code: null });
  const check = event("check", { origin: "agent", what: "all 250 rows exported", expected: "250", command: "npm test", evidence: "250 records written", claimed: "passed", status: "passed", execution_id: run.id, reason: null });
  const unverified = event("check", { origin: "agent", what: "filters apply on every page", expected: "x", command: "npm run filters", evidence: "ok", claimed: "passed", status: "unverified", execution_id: null, reason: "no_execution" });
  const decision = event("decision", { origin: "agent", question: "apply?", quote: "go", reading: "apply the fix", confirmed: false, prompt_event_id: null });
  return [started, observation, hypothesis, rejected, second, run, check, unverified, decision];
}

describe("summarize", () => {
  it("keeps a rejected hypothesis visible with its reason", () => {
    const summary = summarize(TASK, course());
    assert.equal(summary.hypotheses.length, 2);
    assert.equal(summary.hypotheses[0]!.status, "rejected");
    assert.equal(summary.hypotheses[0]!.resolution?.text, "the parameter is passed correctly");
    assert.equal(summary.hypotheses[1]!.status, "open");
  });

  it("marks a passed check current when no later event has another code version", () => {
    const summary = summarize(TASK, course());
    assert.equal(summary.checks[0]!.status, "passed");
    assert.equal(summary.checks[0]!.current, true);
  });

  it("marks a passed check stale after a file change on another working tree", () => {
    const events = [...course(), event("file_changed", { origin: "tool", path: "src/export.ts", created: false, before: "a", after: "b", patch: null, tool: "Edit", code_version: V2, files: ["src/export.ts"] })];
    const summary = summarize(TASK, events);
    assert.equal(summary.checks[0]!.status, "passed");
    assert.equal(summary.checks[0]!.current, false);
    assert.deepEqual(summary.files, ["src/export.ts"]);
    assert.deepEqual(summary.latest_code_version, V2);
  });

  it("lists unverified checks and unconfirmed decisions separately", () => {
    const summary = summarize(TASK, course());
    assert.equal(summary.checks[1]!.status, "unverified");
    assert.equal(summary.checks[1]!.reason, "no_execution");
    assert.equal(summary.checks[1]!.current, false);
    assert.equal(summary.decisions[0]!.confirmed, false);
    assert.deepEqual(summary.counts.by_origin, { user: 1, tool: 1, agent: 7, devguide: 0 });
  });

  it("handles an empty task", () => {
    const summary = summarize(TASK, []);
    assert.equal(summary.counts.events, 0);
    assert.equal(summary.latest_code_version, null);
    assert.equal(formatTimeline([]), "Zadanie nie ma jeszcze zdarzeń.");
    assert.match(formatSummary(summary), /Hipotezy \(0\):\n  brak/);
  });
});

describe("text output", () => {
  it("timeline has one line per event with origin, sentence and id", () => {
    const events = course();
    const lines = formatTimeline(events).split("\n");
    assert.equal(lines.length, events.length);
    assert.match(lines[0]!, /^10:\d\d:00 \[użytkownik\] Rozpoczęto zadanie: Export fetches only page one \(e\d+\)$/);
    assert.match(lines[1]!, /\[AI\] Obserwacja: .* \[ilustracje od AI: 1\]/);
    assert.match(lines[3]!, /Hipoteza e\d+ odrzucona: the parameter is passed correctly/);
    assert.match(lines[5]!, /\[narzędzie\] Uruchomiono polecenie: npm test \(wyjście: 20 znaków, kod wyjścia nieznany\)/);
    assert.match(lines[6]!, /Sprawdzenie: all 250 rows exported — przeszło/);
    assert.match(lines[7]!, /niepotwierdzone \(brak zarejestrowanego wykonania polecenia\)/);
    assert.match(lines[8]!, /Decyzja użytkownika \(niepotwierdzona\)/);
  });

  it("summary text agrees with the summary data", () => {
    const events = course();
    const summary = summarize(TASK, events);
    const text = formatSummary(summary);
    assert.match(text, /^Zadanie 20261021-1000-ab12: Export fetches only page one/);
    assert.match(text, /\[odrzucona\] the page parameter is ignored \(e\d+\)\n      powód: the parameter is passed correctly/);
    assert.match(text, /\[otwarta\] the loop stops after the first page/);
    assert.match(text, /\[przeszło\] all 250 rows exported/);
    assert.match(text, /\[niepotwierdzone\] filters apply on every page .*\n      powód: brak zarejestrowanego wykonania polecenia/);
    assert.match(text, /niepotwierdzone cytatem: 1/);
    for (const check of summary.checks) assert.ok(text.includes(`(${check.id})`));
  });

  it("summary text says when a check passed on an earlier code version", () => {
    const events = [...course(), event("file_changed", { origin: "tool", path: "src/export.ts", created: false, before: "a", after: "b", patch: null, tool: "Edit", code_version: V2 })];
    assert.match(formatSummary(summarize(TASK, events)), /\[przeszło na wcześniejszej wersji kodu\] all 250 rows exported/);
  });

  it("formatEvent prints every field, multi-line values indented", () => {
    const run = event("command_run", { origin: "tool", command: "npm test", stdout: "line 1\nline 2\n", stderr: "", interrupted: false, exit_code: null });
    const text = formatEvent(run);
    assert.match(text, /^Uruchomiono polecenie: npm test/);
    assert.match(text, /\ncommand: npm test\n/);
    assert.match(text, /\nstdout:\n  line 1\n  line 2\n/);
    assert.match(text, /\nexit_code: null/);
  });

  it("describeEvent covers file creation and change", () => {
    assert.equal(describeEvent(event("file_changed", { origin: "tool", path: "a.txt", created: true, before: null, after: "x", patch: null, tool: "Write" })), "Utworzono plik a.txt");
    assert.equal(describeEvent(event("file_changed", { origin: "tool", path: "a.txt", created: false, before: "x", after: "y", patch: null, tool: "Edit" })), "Zmieniono plik a.txt");
  });

  it("session context names the task and the replay command", () => {
    const text = sessionContext(summarize(TASK, course()));
    assert.match(text, /^DevGuide task 20261021-1000-ab12 is open: Export fetches only page one\n/);
    assert.match(text, /hypotheses 2 \(1 open\); checks 2 \(1 passed on the current code, 1 unverified\); decisions 1/);
    assert.match(text, /node process\/cli\.ts replay/);
  });
});
