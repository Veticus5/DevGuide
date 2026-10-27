import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CodeVersion, TaskEvent } from "./events.ts";
import { buildDiff, buildPreviewModel, hunksOf, pathInCommand, splitTitle, type StepBlock } from "./preview-model.ts";
import type { TaskRecord } from "./task-log.ts";

const TASK: TaskRecord = { id: "20261021-1000-ab12", description: "Export fetches only page one", started: "2026-10-21T10:00:00.000Z", session_ids: ["s1"] };
const V1: CodeVersion = { commit: "c".repeat(40), working_tree: "1".repeat(64) };
const V2: CodeVersion = { commit: "c".repeat(40), working_tree: "2".repeat(64) };

let counter = 0;
type Base = { id: string; time: string; task_id: string; session_id: string | null; code_version: CodeVersion; files: string[] };
function event<K extends TaskEvent["kind"]>(kind: K, fields: Omit<Extract<TaskEvent, { kind: K }>, keyof Base | "kind"> & Partial<Base>): Extract<TaskEvent, { kind: K }> {
  counter += 1;
  const base: Base = { id: `e${counter}`, time: `2026-10-21T10:${String(counter).padStart(2, "0")}:00.000Z`, task_id: TASK.id, session_id: "s1", code_version: V1, files: [] };
  return { kind, ...base, ...fields } as unknown as Extract<TaskEvent, { kind: K }>;
}

const HUNK = { oldStart: 3, oldLines: 1, newStart: 3, newLines: 2, lines: ["-page = 1", "+for (let page = 1; ; page++) {", "+  fetch(page)"] };

function edit(path: string, before: string, after: string, patch: unknown = [HUNK], version: CodeVersion = V1) {
  return event("file_changed", { origin: "tool", path, created: false, before, after, patch, tool: "Edit", code_version: version, files: [path] });
}

function explain(title: string, changeIds: string[], files: string[] = ["src/export.ts"]) {
  return event("change_explained", {
    origin: "agent",
    title,
    purpose: "export every row",
    mechanism: "loop over pages until one is empty",
    assumptions: "the API returns an empty page at the end",
    materials: [{ label: "example", content: "3 pages -> 250 rows", nature: "illustration" }],
    change_ids: changeIds,
    files,
  });
}

function run(command: string, stdout: string, version: CodeVersion = V1) {
  return event("command_run", { origin: "tool", command, stdout, stderr: "", interrupted: false, exit_code: null, code_version: version });
}

function check(what: string, executionId: string | null, status: "passed" | "failed" | "inconclusive" | "unverified", extra: Partial<{ reason: "no_execution"; limits: string | null }> = {}) {
  return event("check", {
    origin: "agent",
    what,
    expected: "250 rows",
    command: "npm test",
    evidence: "250 records written",
    claimed: status === "unverified" ? "passed" : status,
    status,
    execution_id: executionId,
    reason: extra.reason ?? null,
    limits: extra.limits ?? null,
  });
}

function started() {
  return event("task_started", { origin: "user", description: TASK.description });
}

function block<K extends StepBlock["kind"]>(blocks: StepBlock[], kind: K): Extract<StepBlock, { kind: K }> {
  const found = blocks.find((item) => item.kind === kind);
  assert.ok(found, `block ${kind}`);
  return found as Extract<StepBlock, { kind: K }>;
}

describe("buildPreviewModel: code", () => {
  it("builds one card per explanation with the tool's snippets and the hunk's line range", () => {
    const change = edit("src/export.ts", "page = 1", "for (let page = 1; ; page++) {\n  fetch(page)");
    const explained = explain("Fetch every page", [change.id]);
    const model = buildPreviewModel(TASK, [change, explained]);
    assert.equal(model.code.cards.length, 1);
    const card = model.code.cards[0]!;
    assert.equal(card.title, "Fetch every page");
    assert.equal(card.unmatched, false);
    assert.equal(card.changes[0]!.event_id, change.id);
    assert.equal(card.changes[0]!.before, "page = 1");
    assert.match(card.changes[0]!.after!, /fetch\(page\)/);
    assert.deepEqual(card.changes[0]!.lines, { start: 3, end: 4 });
    assert.deepEqual(card.changes[0]!.code_version, V1);
    assert.equal(card.materials[0]!.nature, "illustration");
    assert.deepEqual(model.code.unexplained, []);
  });

  it("a card covering two files lists both changes in order of recording", () => {
    const a = edit("src/a.ts", "1", "2");
    const b = edit("src/b.ts", "1", "2");
    const model = buildPreviewModel(TASK, [a, b, explain("Both", [a.id, b.id], ["src/a.ts", "src/b.ts"])]);
    assert.deepEqual(model.code.cards[0]!.changes.map((change) => change.path), ["src/a.ts", "src/b.ts"]);
  });

  it("an explanation without a matching change is a card marked unmatched", () => {
    const model = buildPreviewModel(TASK, [explain("Nothing", [], ["src/missing.ts"])]);
    assert.equal(model.code.cards[0]!.unmatched, true);
    assert.deepEqual(model.code.cards[0]!.changes, []);
  });

  it("changes no explanation covers are listed as unexplained with tool data only", () => {
    const covered = edit("src/a.ts", "1", "2");
    const loose = edit("src/b.ts", "x", "y");
    const model = buildPreviewModel(TASK, [covered, loose, explain("A", [covered.id], ["src/a.ts"])]);
    assert.equal(model.code.unexplained.length, 1);
    assert.equal(model.code.unexplained[0]!.event_id, loose.id);
    assert.equal(model.code.unexplained[0]!.before, "x");
    assert.equal(model.code.unexplained[0]!.after, "y");
  });

  it("a prepared change without file changes is a proposal and no card", () => {
    const prepared = event("change_prepared", { origin: "agent", text: "Add a loop over pages", patch: "--- a\n+++ b\n", materials: [] });
    const model = buildPreviewModel(TASK, [prepared]);
    assert.deepEqual(model.code.cards, []);
    assert.equal(model.code.proposals.length, 1);
    assert.equal(model.code.proposals[0]!.patch, "--- a\n+++ b\n");
  });

  it("the diff groups two changes of one file under one header in order", () => {
    const first = edit("src/export.ts", "a", "b", [{ ...HUNK, newStart: 3 }]);
    const second = edit("src/export.ts", "b", "c", [{ ...HUNK, oldStart: 9, newStart: 9, lines: ["-b", "+c"] }]);
    const diff = buildDiff([first, second]);
    assert.equal(diff.length, 1);
    assert.equal(diff[0]!.path, "src/export.ts");
    assert.equal(diff[0]!.partial, false);
    const text = diff[0]!.text;
    assert.match(text, /^--- a\/src\/export\.ts\n\+\+\+ b\/src\/export\.ts\n@@ -3,1 \+3,2 @@\n/);
    assert.ok(text.indexOf("@@ -3,1 +3,2 @@") < text.indexOf("@@ -9,1 +9,2 @@"));
    assert.match(text, /\n-b\n\+c$/);
  });

  it("a created file without hunks is shown with every line added", () => {
    const created = event("file_changed", { origin: "tool", path: "new.txt", created: true, before: null, after: "one\ntwo\n", patch: [], tool: "Write", files: ["new.txt"] });
    const diff = buildDiff([created]);
    assert.equal(diff[0]!.text, "--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1,2 @@\n+one\n+two");
    assert.equal(diff[0]!.partial, false);
  });

  it("a change without hunks of an existing file falls back to before/after blocks and is marked partial", () => {
    const change = edit("src/x.ts", "old line", "new line", null);
    const diff = buildDiff([change]);
    assert.equal(diff[0]!.partial, true);
    assert.match(diff[0]!.text, /łatka niedostępna/);
    assert.match(diff[0]!.text, /\n-old line\n\+new line$/);
  });

  it("hunksOf rejects a shape that is not a list of hunks", () => {
    assert.deepEqual(hunksOf(null), []);
    assert.deepEqual(hunksOf([{ foo: 1 }]), []);
    assert.deepEqual(hunksOf("@@"), []);
    assert.equal(hunksOf([HUNK]).length, 1);
  });
});

describe("buildPreviewModel: checks", () => {
  it("a check is current without later changes and lists the files changed after its execution otherwise", () => {
    const execution = run("npm test", "250 records written\n");
    const passed = check("all rows exported", execution.id, "passed");
    const current = buildPreviewModel(TASK, [execution, passed]);
    assert.equal(current.checks.items[0]!.current, true);
    assert.deepEqual(current.checks.items[0]!.changed_since, []);
    assert.deepEqual(current.checks.items[0]!.code_version, V1);
    assert.deepEqual(current.header.checks, { current_passed: 1, stale_passed: 0, failed: 0, inconclusive: 0, unverified: 0 });

    const later = edit("src/export.ts", "a", "b", [HUNK], V2);
    const stale = buildPreviewModel(TASK, [execution, passed, later]);
    assert.equal(stale.checks.items[0]!.current, false);
    assert.deepEqual(stale.checks.items[0]!.changed_since, ["src/export.ts"]);
    assert.equal(stale.header.checks.stale_passed, 1);
    assert.equal(stale.header.checks.current_passed, 0);
  });

  it("commands no check refers to are listed as unassessed", () => {
    const assessed = run("npm test", "250 records written\n");
    const loose = run("npm run lint", "ok\n");
    const model = buildPreviewModel(TASK, [assessed, loose, check("rows", assessed.id, "passed")]);
    assert.deepEqual(model.checks.unassessed_commands.map((item) => item.command), ["npm run lint"]);
  });

  it("counts a mixed state and keeps limits and reasons", () => {
    const execution = run("npm test", "250 records written\n");
    const events = [
      execution,
      check("current", execution.id, "passed", { limits: "synthetic data" }),
      run("npm test", "250 records written\n", V2),
      { ...check("unverified", null, "unverified", { reason: "no_execution" }), code_version: V2 },
    ];
    const model = buildPreviewModel(TASK, events);
    assert.deepEqual(model.checks.counts, { current_passed: 0, stale_passed: 1, failed: 0, inconclusive: 0, unverified: 1 });
    assert.equal(model.checks.items[0]!.limits, "synthetic data");
    assert.equal(model.checks.items[1]!.reason, "no_execution");
    assert.equal(model.checks.items[1]!.code_version, null);
    assert.equal(model.checks.unassessed_commands.length, 1);
  });

  it("limits missing from an older event reads as null", () => {
    const execution = run("npm test", "250 records written\n");
    const old = check("old", execution.id, "passed") as TaskEvent & { limits?: string | null };
    delete old.limits;
    assert.equal(buildPreviewModel(TASK, [execution, old]).checks.items[0]!.limits, null);
  });
});

describe("buildPreviewModel: steps (history of meaningful events)", () => {
  it("a task without findings gets one factual step per command, built only from the command and its output", () => {
    const events = [
      started(),
      run("mkdir -p .devguide/scratch && printf 'hello\\n' > .devguide/scratch/hello.txt && cat .devguide/scratch/hello.txt", "hello\n"),
      run("sed -i 's/hello/greetings/' .devguide/scratch/hello.txt && cat .devguide/scratch/hello.txt", "greetings\n"),
      run("echo done", "done\n"),
      event("agent_message", { origin: "agent", text: "All three steps completed without refusals." }),
    ];
    const model = buildPreviewModel(TASK, events);
    const steps = model.steps;
    assert.deepEqual(steps.map((step) => step.kind), ["task", "tool_run", "tool_run", "tool_run"]);
    const task = steps[0]!;
    assert.equal(task.title, "Zgłoszono zadanie");
    assert.match(block(task.blocks, "note").text, /AI nie zapisało żadnych ustaleń/);
    assert.deepEqual(steps.map((step) => step.title), ["Zgłoszono zadanie", "Polecenie na .devguide/scratch/hello.txt", "Polecenie na .devguide/scratch/hello.txt", "Polecenie"]);
    assert.deepEqual(steps.slice(1).map((step) => step.subtitle), ["wyjście: „hello”", "wyjście: „greetings”", "wyjście: „done”"]);
    for (const step of steps.slice(1)) {
      assert.match(step.lead!, /nie zapisało, po co/);
      assert.equal(block(step.blocks, "output").label, "wyjście polecenia");
      assert.doesNotMatch(JSON.stringify({ title: step.title, subtitle: step.subtitle, lead: step.lead, blocks: step.blocks }), /sed -i|printf|echo done/);
    }
    assert.equal(steps[1]!.sources[0]!.command, events[1]!.kind === "command_run" ? events[1]!.command : "");
    assert.equal(steps[3]!.sources.at(-1)!.text, "All three steps completed without refusals.", "the trailing message joins the last step");
    assert.equal(model.header.execution, "Agent zakończył turę i czeka na odpowiedź");
    assert.equal(model.header.verification, "brak zapisanych sprawdzeń");
    assert.equal(model.header.status_line, "Agent zakończył turę i czeka na odpowiedź · brak zapisanych sprawdzeń");
  });

  it("a command without output says so, and a path in a command is read without guessing", () => {
    const begin = started();
    const silent = run("true", "");
    const steps = buildPreviewModel(TASK, [begin, silent]).steps;
    assert.equal(steps[1]!.subtitle, "bez wyjścia");
    assert.match(block(steps[1]!.blocks, "note").text, /nic nie wypisało/);
    assert.equal(pathInCommand("sed -i 's/hello/greetings/' hello.txt && cat hello.txt", []), "hello.txt");
    assert.equal(pathInCommand("printf 'hello\\n' > .devguide/scratch/hello.txt", []), ".devguide/scratch/hello.txt");
    assert.equal(pathInCommand("node process/cli.ts replay --json", ["src/export.ts"]), "process/cli.ts");
    assert.equal(pathInCommand("cat src/a.ts src/export.ts", ["src/export.ts"]), "src/export.ts");
    assert.equal(pathInCommand("echo done", []), null);
    assert.equal(pathInCommand("git log -3 --oneline", []), null);
  });

  it("once a finding exists, earlier commands fold into its sources and the session end is a source too", () => {
    const begin = started();
    const first = run("cat hello.txt", "hello\n");
    const observation = event("observation", { origin: "agent", text: "the file says hello", materials: [] });
    const ended = event("session_ended", { origin: "devguide", reason: "other" });
    const model = buildPreviewModel(TASK, [begin, first, observation, ended]);
    assert.deepEqual(model.steps.map((step) => step.kind), ["task", "observation"]);
    assert.deepEqual(model.steps[1]!.sources.map((source) => source.kind), ["command_run", "observation", "session_ended"]);
    assert.equal(model.header.execution, "Sesja zakończona");
    assert.equal(model.header.status_line, "Sesja zakończona · brak zapisanych sprawdzeń");
    assert.equal(buildPreviewModel(TASK, [begin, first]).header.execution, "Agent pracuje");
  });

  it("a code change lists the checks executed after it, by chronology", () => {
    const begin = started();
    const earlier = run("npm test", "1 passing\n");
    const before = check("old suite", earlier.id, "passed");
    const change = edit("src/export.ts", "a", "b");
    const later = run("npm test", "250 records written\n");
    const after = check("rows", later.id, "passed");
    const steps = buildPreviewModel(TASK, [begin, earlier, before, change, later, after]).steps;
    const changeStep = steps.find((step) => step.kind === "unexplained_change")!;
    assert.deepEqual(changeStep.checks_after, [{ step_id: after.id, title: "rows", status_text: "przeszło", tone: "ok" }]);
    assert.equal(steps.find((step) => step.kind === "task")!.checks_after, null);
    const alone = buildPreviewModel(TASK, [begin, edit("src/x.ts", "1", "2")]).steps[1]!;
    assert.deepEqual(alone.checks_after, []);
  });

  it("commands run before an observation become its sources", () => {
    const events = [started(), run("npm test", "100 rows\n"), run("cat out.csv | wc -l", "100\n"), event("observation", { origin: "agent", text: "Only 100 of 250 rows land in the file", materials: [] })];
    const steps = buildPreviewModel(TASK, events).steps;
    assert.deepEqual(steps.map((step) => step.kind), ["task", "observation"]);
    assert.deepEqual(steps[1]!.sources.map((source) => source.kind), ["command_run", "command_run", "observation"]);
    assert.equal(steps[1]!.title, "Only 100 of 250 rows land in the file");
    assert.equal(steps[1]!.subtitle, "Obserwacja AI");
    assert.deepEqual(steps[0]!.sources.map((source) => source.kind), ["task_started"]);
    assert.equal(steps[0]!.blocks.length, 0, "the task step has no note when the agent recorded findings");
  });

  it("a file change without an explanation is a step with the before/after block", () => {
    const begin = started();
    const change = edit("src/export.ts", "page = 1", "loop");
    const steps = buildPreviewModel(TASK, [begin, change]).steps;
    assert.equal(steps[1]!.kind, "unexplained_change");
    assert.equal(steps[1]!.title, "Zmieniono plik src/export.ts");
    assert.equal(steps[1]!.subtitle, "Bez objaśnienia od AI");
    assert.equal(block(steps[1]!.blocks, "diff").changes[0]!.after, "loop");
    assert.deepEqual(steps[1]!.code_link, { target: `u-${change.id}`, fragments: 1 });
  });

  it("the experiment-like task gives task, change, check, observation and hypothesis steps in the time of their work", () => {
    const begin = started();
    const created = event("file_changed", { origin: "tool", path: "hello.txt", created: true, before: null, after: "hello from devguide", patch: [], tool: "Write", files: ["hello.txt"] });
    const edited = edit("hello.txt", "hello", "greetings", [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-hello from devguide", "+greetings from devguide"] }]);
    const echo = run("echo devguide-ok", "devguide-ok\n");
    const observation = event("observation", { origin: "agent", text: "hello.txt now says greetings", materials: [{ label: "sample", content: "greetings from devguide", nature: "illustration" }] });
    const hypothesis = event("hypothesis", { origin: "agent", text: "the hooks record every step" });
    const explained = event("change_explained", { origin: "agent", title: "Greeting word", purpose: "The file greets with a different word", mechanism: "The word hello is replaced by greetings", assumptions: "Only this one file changes", materials: [], change_ids: [created.id, edited.id], files: ["hello.txt"] });
    const passed = check("echo printed the marker", echo.id, "passed");
    const message = event("agent_message", { origin: "agent", text: "Done." });
    const steps = buildPreviewModel(TASK, [begin, created, edited, echo, observation, hypothesis, explained, passed, message]).steps;
    assert.deepEqual(steps.map((step) => step.kind), ["task", "change", "check", "observation", "hypothesis"]);
    const change = steps[1]!;
    assert.equal(change.time, created.time);
    assert.equal(change.title, "Greeting word");
    assert.equal(change.kicker, "Zmiana w kodzie · 2 fragmenty · po poprawce");
    assert.equal(change.lead, "The file greets with a different word");
    assert.deepEqual(block(change.blocks, "diff").changes.map((item) => [item.before, item.after]), [[null, "hello from devguide"], ["hello", "greetings"]]);
    assert.deepEqual(block(change.blocks, "explanation"), { kind: "explanation", mechanism: "The word hello is replaced by greetings", assumptions: "Only this one file changes" });
    assert.deepEqual(change.code_link, { target: `card-${explained.id}`, fragments: 2 });
    assert.deepEqual(change.sources.map((source) => source.event_id), [created.id, edited.id, explained.id]);
    const checkStep = steps[2]!;
    assert.equal(checkStep.time, echo.time);
    assert.equal(checkStep.title, "echo printed the marker");
    assert.equal(checkStep.subtitle, "Sprawdzenie · przeszło");
    const result = block(checkStep.blocks, "check");
    assert.equal(result.status_text, "przeszło");
    assert.equal(result.evidence, "250 records written");
    assert.equal(result.evidence_verified, true);
    assert.equal(result.output!.excerpt, "devguide-ok");
    assert.equal(result.changed_since, null);
    assert.deepEqual(checkStep.sources.map((source) => source.event_id), [echo.id, passed.id]);
    assert.equal(steps[3]!.subtitle, "Obserwacja · 1 przykład od AI");
    assert.equal(block(steps[3]!.blocks, "example").note, "Przykład od AI. Nie jest wynikiem sprawdzenia.");
    assert.equal(steps[4]!.subtitle, "Podejrzenie · otwarte");
    assert.equal(steps[4]!.sources.at(-1)!.kind, "agent_message", "the trailing message joins the last step");
  });

  it("a rejected hypothesis keeps its state, and the resolution step points back at it", () => {
    const begin = started();
    const hypothesis = event("hypothesis", { origin: "agent", text: "the page parameter is ignored" });
    const rejected = event("hypothesis_resolved", { origin: "agent", hypothesis_id: hypothesis.id, outcome: "rejected", text: "the parameter is passed correctly" });
    const again = event("hypothesis", { origin: "agent", text: "the loop stops early" });
    const steps = buildPreviewModel(TASK, [begin, hypothesis, rejected, again]).steps;
    assert.deepEqual(steps.map((step) => step.kind), ["task", "hypothesis", "resolution", "hypothesis"]);
    assert.equal(steps[1]!.subtitle, "Podejrzenie · odrzucone");
    assert.equal(block(steps[1]!.blocks, "hypothesis_state").resolution, "the parameter is passed correctly");
    assert.equal(steps[2]!.title, "Odrzucono podejrzenie");
    assert.equal(steps[2]!.lead, "the parameter is passed correctly");
    assert.equal(block(steps[2]!.blocks, "hypothesis_state").hypothesis, "the page parameter is ignored");
    assert.equal(steps[2]!.refs.hypothesis_id, hypothesis.id);
    assert.equal(steps[3]!.subtitle, "Podejrzenie · otwarte");
  });

  it("a stale check names the files changed since; an unverified one is marked missing with the claim as a claim", () => {
    const execution = run("npm test", "250 records written\n");
    const passed = check("rows", execution.id, "passed", { limits: "synthetic data" });
    const later = edit("src/export.ts", "a", "b", [HUNK], V2);
    const unverified = { ...check("filters", null, "unverified", { reason: "no_execution" }), code_version: V2 };
    const steps = buildPreviewModel(TASK, [started(), execution, passed, later, unverified]).steps;
    const stale = block(steps.find((step) => step.title === "rows")!.blocks, "check");
    assert.equal(stale.status_text, "przeszło na wcześniejszej wersji kodu");
    assert.deepEqual(stale.changed_since, ["src/export.ts"]);
    assert.equal(stale.limits, "synthetic data");
    const claimStep = steps.find((step) => step.title === "filters")!;
    const claim = block(claimStep.blocks, "check");
    assert.equal(claim.evidence_verified, false);
    assert.equal(claim.claimed_text, "przeszło");
    assert.equal(claim.reason_text, "brak zarejestrowanego wykonania polecenia");
    assert.equal(claim.output, null);
    assert.match(block(claimStep.blocks, "missing").text, /tylko deklaracją AI/);
  });

  it("a prepared fix without later changes carries the demonstration decision; a later change removes it", () => {
    const begin = started();
    const prepared = event("change_prepared", { origin: "agent", text: "Loop over pages", patch: "--- a\n+++ b\n-page = 1\n+loop\n", materials: [], files: ["src/export.ts"] });
    const pending = buildPreviewModel(TASK, [begin, prepared]);
    const step = pending.steps[1]!;
    assert.equal(step.kind, "prepared");
    assert.deepEqual(step.decision, { demo: true });
    assert.equal(step.subtitle, "Oczekuje na decyzję (demonstracja)");
    assert.equal(block(step.blocks, "patch").excerpt, "--- a\n+++ b\n-page = 1\n+loop");
    assert.match(pending.header.status_line, /^Przygotowana poprawka czeka na decyzję · demonstracja/);
    const applied = buildPreviewModel(TASK, [begin, prepared, edit("src/export.ts", "page = 1", "loop", [HUNK], V2)]);
    assert.equal(applied.steps[1]!.decision, null);
    assert.equal(applied.steps[1]!.subtitle, "Później zmieniono pliki");
  });

  it("a decision step records question, quote, reading and confirmation", () => {
    const begin = started();
    const decision = event("decision", { origin: "agent", question: "apply?", quote: "go", reading: "apply", confirmed: false, prompt_event_id: null });
    const steps = buildPreviewModel(TASK, [begin, decision]).steps;
    assert.equal(steps[1]!.title, "Decyzja użytkownika");
    assert.equal(steps[1]!.subtitle, "Niepotwierdzona");
    assert.deepEqual(block(steps[1]!.blocks, "decision_record"), { kind: "decision_record", question: "apply?", quote: "go", reading: "apply", confirmed: false });
    assert.equal(steps[1]!.decision, null);
  });

  it("an empty task gives no steps and an empty model", () => {
    const model = buildPreviewModel(TASK, []);
    assert.deepEqual(model.steps, []);
    assert.deepEqual(model.code, { cards: [], unexplained: [], proposals: [], diff: [] });
    assert.deepEqual(model.checks.items, []);
    assert.equal(model.header.latest_code_version, null);
  });
});

describe("buildPreviewModel: header", () => {
  it("splits the title from a long description and keeps the repo name", () => {
    const long = { ...TASK, description: "Integration experiment, code word tulip. Do these steps in order:\n1. Write a file" };
    const model = buildPreviewModel(long, [], { repo: "DevGuide" });
    assert.equal(model.header.title, "Integration experiment, code word tulip.");
    assert.equal(model.header.goal, long.description);
    assert.equal(model.header.repo, "DevGuide");
    assert.equal(model.header.task_id, TASK.id);
    assert.deepEqual(splitTitle("Short"), { title: "Short", goal: null });
    assert.equal(splitTitle("x".repeat(200)).title.length, 90);
    assert.equal(splitTitle("   ").title, "Zadanie bez opisu");
  });

  it("the status line names only what exists", () => {
    const execution = run("npm test", "250 records written\n");
    const one = buildPreviewModel(TASK, [started(), execution, check("rows", execution.id, "passed")]);
    assert.equal(one.header.status_line, "Agent pracuje · 1 sprawdzenie potwierdza bieżący kod");
    assert.equal(buildPreviewModel(TASK, [started()]).header.status_line, "Agent pracuje · brak zapisanych sprawdzeń");
    const begin2 = started();
    const hypothesis = event("hypothesis", { origin: "agent", text: "h" });
    const rejected = event("hypothesis_resolved", { origin: "agent", hypothesis_id: hypothesis.id, outcome: "rejected", text: "no" });
    const mixed = buildPreviewModel(TASK, [begin2, hypothesis, rejected, { ...check("x", null, "unverified", { reason: "no_execution" }) }]);
    assert.equal(mixed.header.status_line, "Agent pracuje · 1 sprawdzenie niepotwierdzone · 1 podejrzenie odrzucone");
  });
});
