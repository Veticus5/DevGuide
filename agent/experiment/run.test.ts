import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BLOCK_MARKER, type LogEntry } from "../hooks/record-event.ts";
import { CONFIRMATION_LINE, allPassed, evaluate, formatReport, type ExperimentObservations } from "./evaluate.ts";

const SESSION = "11111111-1111-1111-1111-111111111111";
const WORD = "tulip-abc";

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

function completeObservations(overrides: Partial<ExperimentObservations> = {}): ExperimentObservations {
  return {
    sessionId: SESSION,
    codeWord: WORD,
    helloFile: "hello.txt",
    blockedFile: "blocked.txt",
    helloExists: true,
    helloContent: "greetings from devguide",
    blockedExists: false,
    firstAnswer: `${CONFIRMATION_LINE}\n1. created\n2. edited\n3. devguide-ok\n4. refused by DevGuide hook\n5. noted`,
    secondAnswer: WORD,
    entries: completeLog(),
    ...overrides,
  };
}

describe("evaluate", () => {
  it("answers every question with tak when all evidence is present", () => {
    const findings = evaluate(completeObservations());
    assert.equal(findings.length, 5);
    assert.deepEqual(
      findings.map((finding) => finding.verdict),
      ["tak", "tak", "tak", "tak", "tak"],
    );
    assert.equal(allPassed(findings), true);
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
    assert.match(report, /wszystkie pięć pytań potwierdzone/);
  });
});
