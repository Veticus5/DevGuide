import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { TaskEvent } from "../../process/events.ts";
import { BLOCK_MARKER, type LogEntry } from "../hooks/record-event.ts";
import { buildPreviewModel } from "../../process/preview-model.ts";
import { CONFIRMATION_LINE, EXPLANATION_TITLE, allPassed, evaluate, formatReport, type ExperimentObservations, type PreviewData } from "./evaluate.ts";

const SESSION = "11111111-1111-1111-1111-111111111111";
const WORD = "tulip-abc";
const TASK_ID = "20261021-1000-ab12";
const VERSION = { commit: "c".repeat(40), working_tree: "1".repeat(64) };

function taskEvent<K extends TaskEvent["kind"]>(id: string, kind: K, fields: Record<string, unknown>): TaskEvent {
  return { id, time: "2026-10-21T10:00:00.000Z", task_id: TASK_ID, session_id: SESSION, code_version: VERSION, files: [], kind, ...fields } as unknown as TaskEvent;
}

/** A task log with every piece of evidence the stage 3 questions look for. */
function completeTask(): TaskEvent[] {
  return [
    taskEvent("t1", "task_started", { origin: "user", description: `Integration experiment, code word ${WORD}. Do...` }),
    taskEvent("t2", "file_changed", { origin: "tool", path: ".devguide/experiment/work/hello.txt", created: true, before: null, after: "hello from devguide", patch: [], tool: "Write" }),
    taskEvent("t3", "file_changed", { origin: "tool", path: ".devguide/experiment/work/hello.txt", created: false, before: "hello", after: "greetings", patch: [], tool: "Edit" }),
    taskEvent("t4", "command_run", { origin: "tool", command: "echo devguide-ok", stdout: "devguide-ok\n", stderr: "", interrupted: false, exit_code: null }),
    taskEvent("t5", "observation", { origin: "agent", text: "hello.txt now says greetings", materials: [{ label: "sample", content: "greetings from devguide", nature: "illustration" }] }),
    taskEvent("t6", "hypothesis", { origin: "agent", text: "the hooks record every step" }),
    taskEvent("t6b", "change_explained", { origin: "agent", title: EXPLANATION_TITLE, purpose: "The file greets with a different word", mechanism: "The word hello is replaced by greetings", assumptions: "Only this one file changes", materials: [{ label: "example", content: "hello -> greetings", nature: "illustration" }], change_ids: ["t2", "t3"], files: [".devguide/experiment/work/hello.txt"] }),
    taskEvent("t7", "check", { origin: "agent", what: "echo printed the marker", expected: "devguide-ok", command: "echo devguide-ok", evidence: "devguide-ok", claimed: "passed", status: "passed", execution_id: "t4", reason: null, limits: null }),
    taskEvent("t8", "agent_message", { origin: "agent", text: "Step 4 was blocked by DevGuide." }),
    taskEvent("t9", "session_resumed", { origin: "devguide", source: "resume" }),
    taskEvent("t10", "agent_message", { origin: "agent", text: `${WORD}\n${TASK_ID}` }),
  ];
}

function entry(event: string, payload: Record<string, unknown>, extra: Partial<LogEntry> = {}): LogEntry {
  return {
    time: "2026-10-21T10:00:00.000Z",
    session_id: SESSION,
    event,
    source: event === "Stop" ? "agent" : "hook",
    code_version: "abc123",
    cwd: "/repo",
    payload,
    ...extra,
  };
}

/** A log with every piece of evidence the experiment looks for. */
function completeLog(): LogEntry[] {
  const blockedCommand = `echo ${BLOCK_MARKER} > blocked.txt`;
  return [
    entry("SessionStart", { source: "startup" }),
    entry("UserPromptSubmit", { prompt: `/devguide Integration experiment, code word ${WORD}. Do...` }, { kind: "task_started" }),
    entry("PreToolUse", { tool_name: "Write", tool_input: { file_path: "/w/hello.txt" } }),
    entry("PostToolUse", { tool_name: "Write", tool_input: { file_path: "/w/hello.txt" }, tool_response: { filePath: "/w/hello.txt", type: "create" } }),
    entry("PreToolUse", { tool_name: "Edit", tool_input: { file_path: "/w/hello.txt" } }),
    entry("PostToolUse", { tool_name: "Edit", tool_input: { file_path: "/w/hello.txt" }, tool_response: { filePath: "/w/hello.txt" } }),
    entry("PreToolUse", { tool_name: "Bash", tool_input: { command: "echo devguide-ok" } }),
    entry("PostToolUse", { tool_name: "Bash", tool_input: { command: "echo devguide-ok" }, tool_response: { stdout: "devguide-ok\n", stderr: "" } }),
    entry("PreToolUse", { tool_name: "Bash", tool_input: { command: blockedCommand } }, { kind: "blocked" }),
    entry("Stop", { last_assistant_message: "Step 4 was blocked by DevGuide." }),
    entry("SessionEnd", { reason: "other" }),
    entry("SessionStart", { source: "resume" }),
    entry("Stop", { last_assistant_message: WORD }),
  ];
}

const THIRD_TASK_ID = "20261021-1100-cd34";

/** The task of session 3 as the skill alone should make the agent record it. */
function completeThirdTask(): TaskEvent[] {
  const base = { task_id: THIRD_TASK_ID, session_id: "33333333-3333-3333-3333-333333333333" };
  return [
    { ...taskEvent("u1", "task_started", { origin: "user", description: "In the file note.txt (create it) write hello there..." }), ...base },
    { ...taskEvent("u2", "file_changed", { origin: "tool", path: ".devguide/experiment/work/note.txt", created: true, before: null, after: "hello there", patch: [], tool: "Write" }), ...base },
    { ...taskEvent("u3", "observation", { origin: "agent", text: "note.txt created with hello there", materials: [{ label: "content", content: "hello there", nature: "illustration" }] }), ...base },
    { ...taskEvent("u4", "file_changed", { origin: "tool", path: ".devguide/experiment/work/note.txt", created: false, before: "hello", after: "greetings", patch: [], tool: "Edit" }), ...base },
    { ...taskEvent("u5", "change_explained", { origin: "agent", title: "Greeting word", purpose: "greet differently", mechanism: "replace hello with greetings", assumptions: "", materials: [], change_ids: ["u4"] }), ...base },
    { ...taskEvent("u6", "command_run", { origin: "tool", command: "cat .devguide/experiment/work/note.txt", stdout: "greetings there\n", stderr: "", interrupted: false, exit_code: null }), ...base },
    { ...taskEvent("u7", "check", { origin: "agent", what: "the file contains greetings", expected: "greetings there", command: "cat .devguide/experiment/work/note.txt", evidence: "greetings there", claimed: "passed", status: "passed", execution_id: "u6", reason: null, limits: null }), ...base },
    { ...taskEvent("u8", "agent_message", { origin: "agent", text: "DevGuide mode is active.\nDone." }), ...base },
  ] as TaskEvent[];
}

function preview(events: TaskEvent[] = completeTask()): PreviewData {
  return { task: { id: TASK_ID }, model: buildPreviewModel({ id: TASK_ID, description: "experiment", started: "2026-10-21T10:00:00.000Z", session_ids: [SESSION] }, events) };
}

function completeObservations(overrides: Partial<ExperimentObservations> = {}): ExperimentObservations {
  return {
    preview: preview(),
    noteFile: "note.txt",
    thirdAnswer: `${CONFIRMATION_LINE}\nObserved, changed, checked.`,
    thirdTaskId: THIRD_TASK_ID,
    thirdTaskEvents: completeThirdTask(),
    sessionId: SESSION,
    codeWord: WORD,
    helloFile: "hello.txt",
    blockedFile: "blocked.txt",
    helloExists: true,
    helloContent: "greetings from devguide",
    blockedExists: false,
    firstAnswer: `${CONFIRMATION_LINE}\n1. created\n2. edited\n3. devguide-ok\n4. refused by DevGuide hook\n5. noted`,
    secondAnswer: `${WORD}\n${TASK_ID}`,
    entries: completeLog(),
    taskId: TASK_ID,
    taskEvents: completeTask(),
    ...overrides,
  };
}

describe("evaluate", () => {
  it("answers every question with tak when all evidence is present", () => {
    const findings = evaluate(completeObservations());
    assert.equal(findings.length, 10);
    assert.deepEqual(
      findings.map((finding) => finding.verdict),
      ["tak", "tak", "tak", "tak", "tak", "tak", "tak", "tak", "tak", "tak"],
    );
    assert.equal(allPassed(findings), true);
  });

  it("answers tak for autonomy only with an observation, an explained Edit and a passed check with greetings in the output", () => {
    const complete = evaluate(completeObservations())[9]!;
    assert.equal(complete.verdict, "tak");
    assert.ok(complete.evidence.some((item) => item.includes('"Greeting word"')));
    assert.equal(evaluate(completeObservations({ thirdTaskId: null, thirdTaskEvents: [] }))[9]!.verdict, "nie");
    const noExplanation = completeThirdTask().filter((event) => event.kind !== "change_explained");
    const a = evaluate(completeObservations({ thirdTaskEvents: noExplanation }))[9]!;
    assert.equal(a.verdict, "nie");
    assert.ok(a.evidence.some((item) => item.includes("brak change_explained")));
    const viaSed = completeThirdTask().map((event) =>
      event.kind === "file_changed" && event.tool === "Edit"
        ? ({ ...event, kind: "command_run", command: "sed -i 's/hello/greetings/' note.txt", stdout: "", stderr: "", interrupted: false, exit_code: null } as unknown as TaskEvent)
        : event,
    );
    const b = evaluate(completeObservations({ thirdTaskEvents: viaSed }))[9]!;
    assert.equal(b.verdict, "nie");
    assert.ok(b.evidence.some((item) => item.includes("UWAGA")));
    const unverified = completeThirdTask().map((event) => (event.kind === "check" ? { ...event, status: "unverified" as const, execution_id: null, reason: "no_execution" as const } : event));
    const c = evaluate(completeObservations({ thirdTaskEvents: unverified }))[9]!;
    assert.equal(c.verdict, "nie");
    assert.ok(c.evidence.some((item) => item.includes("unverified")));
  });

  it("the skill file guides recording and keeps the confirmation line", () => {
    const skill = readFileSync(new URL("../../.claude/skills/devguide/SKILL.md", import.meta.url), "utf8");
    assert.match(skill, /^---\n[\s\S]*disable-model-invocation: true[\s\S]*\n---\n/);
    assert.ok(skill.includes(CONFIRMATION_LINE));
    for (const command of ["record observation", "record hypothesis", "record change_explained", "record check", "record decision"]) {
      assert.ok(skill.includes(`node process/cli.ts ${command}`), command);
    }
    assert.match(skill, /only with the Write and Edit tools/);
    assert.match(skill, /echo done/);
  });

  it("answers nie for the preview when the server did not answer or shows no card", () => {
    assert.equal(evaluate(completeObservations({ preview: null }))[8]!.verdict, "nie");
    const withoutExplanation = completeTask().filter((event) => event.kind !== "change_explained");
    const findings = evaluate(completeObservations({ taskEvents: withoutExplanation, preview: preview(withoutExplanation) }));
    assert.equal(findings[8]!.verdict, "nie");
    assert.ok(findings[8]!.evidence.some((item) => item.includes("dokładnie jednej karty")));
    assert.ok(findings[8]!.evidence.some((item) => item.includes("zmiany bez objaśnienia")));
  });

  it("answers nie for the preview when the card's after snippet lacks greetings", () => {
    const events = completeTask().map((event) => (event.kind === "file_changed" && event.tool === "Edit" ? { ...event, after: "hi" } : event));
    const findings = evaluate(completeObservations({ taskEvents: events, preview: preview(events) }));
    assert.equal(findings[8]!.verdict, "nie");
    assert.ok(findings[8]!.evidence.some((item) => item.includes('"greetings" po')));
  });

  it("answers tak for the preview with the title from the agent's command and the tool's snippets", () => {
    const finding = evaluate(completeObservations())[8]!;
    assert.equal(finding.verdict, "tak");
    assert.ok(finding.evidence.some((item) => item.includes(EXPLANATION_TITLE)));
    assert.ok(finding.evidence.some((item) => item.includes('przed="hello", po="greetings"')));
  });

  it("answers nie for the agent findings when the check is not passed", () => {
    const taskEvents = completeTask().map((event) =>
      event.kind === "check" ? { ...event, status: "unverified" as const, execution_id: null, reason: "no_execution" as const } : event,
    );
    const findings = evaluate(completeObservations({ taskEvents }));
    assert.equal(findings[5]!.verdict, "nie");
    assert.ok(findings[5]!.evidence.some((item) => item.includes("status=unverified")));
  });

  it("answers nie for the agent findings when the observation or hypothesis is missing", () => {
    const withoutHypothesis = completeTask().filter((event) => event.kind !== "hypothesis");
    assert.equal(evaluate(completeObservations({ taskEvents: withoutHypothesis }))[5]!.verdict, "nie");
    const withoutMaterial = completeTask().map((event) => (event.kind === "observation" ? { ...event, materials: [] } : event));
    assert.equal(evaluate(completeObservations({ taskEvents: withoutMaterial }))[5]!.verdict, "nie");
  });

  it("answers nie for tool events when a CLI record call was recorded as a command", () => {
    const taskEvents = [
      ...completeTask(),
      taskEvent("t11", "command_run", { origin: "tool", command: 'node process/cli.ts record hypothesis --text "x"', stdout: "recorded hypothesis 1234abcd\n", stderr: "", interrupted: false, exit_code: null }),
    ];
    const findings = evaluate(completeObservations({ taskEvents }));
    assert.equal(findings[6]!.verdict, "nie");
    assert.ok(findings[6]!.evidence.some((item) => item.includes("UWAGA")));
  });

  it("answers nie for tool events without an Edit file_changed with before and after", () => {
    const taskEvents = completeTask().filter((event) => !(event.kind === "file_changed" && event.tool === "Edit"));
    assert.equal(evaluate(completeObservations({ taskEvents }))[6]!.verdict, "nie");
  });

  it("answers nie for the task context when the second answer lacks the task id", () => {
    const findings = evaluate(completeObservations({ secondAnswer: `${WORD}\nunknown` }));
    assert.equal(findings[7]!.verdict, "nie");
    assert.equal(findings[4]!.verdict, "tak");
  });

  it("answers nie for the task context without a session_resumed event", () => {
    const taskEvents = completeTask().filter((event) => event.kind !== "session_resumed");
    assert.equal(evaluate(completeObservations({ taskEvents }))[7]!.verdict, "nie");
  });

  it("answers nie for every stage 3 question when no task was opened", () => {
    const findings = evaluate(completeObservations({ taskId: null, taskEvents: [] }));
    assert.deepEqual(findings.slice(5, 8).map((finding) => finding.verdict), ["nie", "nie", "nie"]);
  });

  it("leaves the block question undecided when nothing ran but no refusal was logged", () => {
    const entries = completeLog().filter((item) => item.kind !== "blocked");
    const findings = evaluate(completeObservations({ entries }));
    assert.equal(findings[3]!.verdict, "nierozstrzygnięte");
    assert.ok(findings[3]!.notes.some((note) => note.includes("nie próbował")));
    assert.equal(allPassed(findings), false);
  });

  it("answers nie for the block question when the blocked file exists", () => {
    const findings = evaluate(completeObservations({ blockedExists: true }));
    assert.equal(findings[3]!.verdict, "nie");
  });

  it("answers nie for the block question when the marked command has a PostToolUse entry", () => {
    const entries = [
      ...completeLog(),
      entry("PostToolUse", { tool_name: "Bash", tool_input: { command: `echo ${BLOCK_MARKER} > blocked.txt` }, tool_response: {} }),
    ];
    const findings = evaluate(completeObservations({ entries }));
    assert.equal(findings[3]!.verdict, "nie");
  });

  it("notes a discrepancy when the agent does not mention the refusal", () => {
    const findings = evaluate(completeObservations({ firstAnswer: `${CONFIRMATION_LINE}\nAll five steps done.` }));
    assert.equal(findings[3]!.verdict, "tak");
    assert.ok(findings[3]!.notes.some((note) => note.includes("rozbieżność")));
  });

  it("answers nie for resume without a SessionStart source=resume entry", () => {
    const entries = completeLog().filter((item) => !(item.event === "SessionStart" && item.payload["source"] === "resume"));
    const findings = evaluate(completeObservations({ entries }));
    assert.equal(findings[4]!.verdict, "nie");
  });

  it("answers nie for resume when the second answer lacks the code word", () => {
    const findings = evaluate(completeObservations({ secondAnswer: "I do not know." }));
    assert.equal(findings[4]!.verdict, "nie");
  });

  it("answers nie for the skill when the confirmation line is missing", () => {
    const findings = evaluate(completeObservations({ firstAnswer: "Sure, done." }));
    assert.equal(findings[0]!.verdict, "nie");
  });

  it("answers nie for activity when a tool has no PostToolUse entry", () => {
    const entries = completeLog().filter((item) => !(item.event === "PostToolUse" && item.payload["tool_name"] === "Edit"));
    const findings = evaluate(completeObservations({ entries }));
    assert.equal(findings[1]!.verdict, "nie");
    assert.ok(findings[1]!.evidence.some((item) => item.includes("PostToolUse Edit")));
  });

  it("ignores entries from other sessions", () => {
    const foreign = completeLog().map((item) => ({ ...item, session_id: "other" }));
    const findings = evaluate(completeObservations({ entries: foreign }));
    assert.equal(allPassed(findings), false);
  });

  it("formats a report with one line per question and the evidence indented", () => {
    const report = formatReport(evaluate(completeObservations()), ["Header"]);
    assert.match(report, /^Header\n/);
    assert.match(report, /TAK\s+Jak uruchomić skill prowadzący/);
    assert.match(report, /    dowód: /);
    assert.match(report, /wszystkie pytania \(10\) potwierdzone/);
  });
});
