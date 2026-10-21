import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import type { CheckEvent, CodeVersion, CommandRunEvent, DecisionEvent, FileChangedEvent, TaskEvent } from "./events.ts";
import { currentTaskFile, taskEventsFile, taskFile } from "./paths.ts";
import {
  TaskLogError,
  appendAgentEvent,
  currentTask,
  displayPath,
  isTaskStart,
  readEvents,
  recordHookEvent,
  startTask,
  taskDescription,
  type OpenTask,
  type TaskLogDeps,
} from "./task-log.ts";

const VERSION_A: CodeVersion = { commit: "a".repeat(40), working_tree: "1".repeat(64) };
const VERSION_B: CodeVersion = { commit: "a".repeat(40), working_tree: "2".repeat(64) };

function deps(version: CodeVersion = VERSION_A, time = "2026-10-21T10:00:00.000Z"): TaskLogDeps {
  let tick = 0;
  return {
    now: () => new Date(new Date(time).getTime() + tick++ * 1000),
    codeVersion: () => version,
  };
}

describe("tasks on disk", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "devguide-tasklog-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("startTask creates the task files, the pointer and the first event", () => {
    const task = startTask(dir, "fix the export", "session-1", VERSION_A, new Date("2026-10-21T10:00:00Z"));
    assert.match(task.record.id, /^20261021-1000-[0-9a-f]{4}$/);
    assert.ok(existsSync(taskFile(dir, task.record.id)));
    assert.equal(readFileSync(currentTaskFile(dir), "utf8").trim(), task.record.id);
    const events = readEvents(task);
    assert.equal(events.length, 1);
    assert.equal(events[0]!.kind, "task_started");
    assert.equal(events[0]!.origin, "user");
    assert.equal(events[0]!.session_id, "session-1");
    assert.deepEqual(events[0]!.code_version, VERSION_A);
    assert.equal(currentTask(dir)?.record.id, task.record.id);
  });

  it("a second task gets its own directory and the pointer, the first one stays intact", () => {
    const first = startTask(dir, "one", "s", VERSION_A, new Date("2026-10-21T10:00:00Z"));
    appendAgentEvent(first, "hypothesis", { text: "h" }, deps());
    const second = startTask(dir, "two", "s", VERSION_A, new Date("2026-10-21T11:00:00Z"));
    assert.notEqual(first.record.id, second.record.id);
    assert.equal(currentTask(dir)?.record.id, second.record.id);
    assert.equal(readEvents(first).length, 2);
    assert.equal(readEvents(second).length, 1);
  });

  it("readEvents returns events in the order they were written", () => {
    const task = startTask(dir, "t", "s", VERSION_A);
    appendAgentEvent(task, "observation", { text: "first" }, deps());
    appendAgentEvent(task, "hypothesis", { text: "second" }, deps());
    assert.deepEqual(
      readEvents(task).map((event) => event.kind),
      ["task_started", "observation", "hypothesis"],
    );
  });

  it("currentTask is null before any task and when the pointer is stale", () => {
    assert.equal(currentTask(dir), null);
    assert.equal(currentTask(join(dir, "missing")), null);
  });
});

describe("recordHookEvent", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "devguide-hook-events-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const hook = (input: Record<string, unknown>, d: TaskLogDeps = deps()) =>
    recordHookEvent({ session_id: "session-1", cwd: dir, ...input }, dir, d);

  it("a /devguide prompt starts a task with the description", () => {
    const result = hook({ hook_event_name: "UserPromptSubmit", prompt: "/devguide Export fetches only page one" });
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0]!.kind, "task_started");
    assert.equal((result.events[0] as { description: string }).description, "Export fetches only page one");
    assert.equal(result.context, null);
    assert.equal(currentTask(dir)?.record.description, "Export fetches only page one");
  });

  it("does nothing when no task is open", () => {
    const result = hook({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "ls" }, tool_response: { stdout: "" } });
    assert.deepEqual(result, { events: [], context: null });
    const start = hook({ hook_event_name: "SessionStart", source: "startup" });
    assert.deepEqual(start, { events: [], context: null });
    assert.equal(existsSync(join(dir, "tasks")), false);
  });

  describe("with an open task", () => {
    let task: OpenTask;

    beforeEach(() => {
      task = startTask(dir, "task", "session-1", VERSION_A);
    });

    it("records a later user prompt verbatim", () => {
      hook({ hook_event_name: "UserPromptSubmit", prompt: "Yes, apply fix A" });
      const last = readEvents(task).at(-1)!;
      assert.equal(last.kind, "user_prompt");
      assert.equal(last.origin, "user");
      assert.equal((last as { text: string }).text, "Yes, apply fix A");
    });

    it("turns a Write into a created file with its content", () => {
      const path = join(dir, "work", "hello.txt");
      hook({
        hook_event_name: "PostToolUse",
        tool_name: "Write",
        tool_input: { file_path: path, content: "hello from devguide" },
        tool_response: { type: "create", filePath: path, content: "hello from devguide", structuredPatch: [], originalFile: null, userModified: false },
      });
      const last = readEvents(task).at(-1) as FileChangedEvent;
      assert.equal(last.kind, "file_changed");
      assert.equal(last.origin, "tool");
      assert.equal(last.path, "work/hello.txt");
      assert.deepEqual(last.files, ["work/hello.txt"]);
      assert.equal(last.created, true);
      assert.equal(last.before, null);
      assert.equal(last.after, "hello from devguide");
      assert.equal(last.tool, "Write");
    });

    it("turns an Edit into a changed file with before, after and the patch", () => {
      const path = join(dir, "work", "hello.txt");
      const patch = [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-hello from devguide", "+greetings from devguide"] }];
      hook({
        hook_event_name: "PostToolUse",
        tool_name: "Edit",
        tool_input: { file_path: path, old_string: "hello", new_string: "greetings" },
        tool_response: { filePath: path, oldString: "hello", newString: "greetings", originalFile: "hello from devguide", structuredPatch: patch, userModified: false, replaceAll: false },
      });
      const last = readEvents(task).at(-1) as FileChangedEvent;
      assert.equal(last.kind, "file_changed");
      assert.equal(last.created, false);
      assert.equal(last.before, "hello");
      assert.equal(last.after, "greetings");
      assert.deepEqual(last.patch, patch);
      assert.equal(last.tool, "Edit");
    });

    it("turns a Bash call into a command run with unknown exit code", () => {
      hook({
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        tool_input: { command: "echo devguide-ok" },
        tool_response: { stdout: "devguide-ok\n", stderr: "", interrupted: false, isImage: false, noOutputExpected: false },
      });
      const last = readEvents(task).at(-1) as CommandRunEvent;
      assert.equal(last.kind, "command_run");
      assert.equal(last.origin, "tool");
      assert.equal(last.command, "echo devguide-ok");
      assert.equal(last.stdout, "devguide-ok\n");
      assert.equal(last.stderr, "");
      assert.equal(last.interrupted, false);
      assert.equal(last.exit_code, null);
    });

    it("skips the agent's own record commands", () => {
      hook({
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        tool_input: { command: 'node process/cli.ts record hypothesis --text "x"' },
        tool_response: { stdout: "recorded hypothesis 1234abcd\n", stderr: "" },
      });
      assert.equal(readEvents(task).length, 1);
    });

    it("ignores tools that neither change files nor run commands", () => {
      hook({ hook_event_name: "PostToolUse", tool_name: "Read", tool_input: { file_path: "x" }, tool_response: {} });
      hook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls" } });
      assert.equal(readEvents(task).length, 1);
    });

    it("records a tool failure with the error as it came", () => {
      hook({ hook_event_name: "PostToolUseFailure", tool_name: "Bash", tool_input: { command: "false" }, error: "exit 1" });
      const last = readEvents(task).at(-1)!;
      assert.equal(last.kind, "tool_failed");
      assert.equal((last as { tool: string }).tool, "Bash");
      assert.equal((last as { error: unknown }).error, "exit 1");
    });

    it("records the agent's end-of-turn message", () => {
      hook({ hook_event_name: "Stop", last_assistant_message: "I think the loop stops early." });
      const last = readEvents(task).at(-1)!;
      assert.equal(last.kind, "agent_message");
      assert.equal(last.origin, "agent");
    });

    it("records a resume and returns context naming the task", () => {
      const result = hook({ hook_event_name: "SessionStart", session_id: "session-2", source: "resume" });
      assert.equal(result.events[0]!.kind, "session_resumed");
      assert.equal(result.events[0]!.origin, "devguide");
      assert.match(result.context ?? "", new RegExp(`DevGuide task ${task.record.id} is open`));
      assert.match(result.context ?? "", /process\/cli\.ts replay/);
      assert.deepEqual(currentTask(dir)?.record.session_ids, ["session-1", "session-2"]);
    });

    it("a new /devguide prompt opens a second task", () => {
      hook({ hook_event_name: "UserPromptSubmit", prompt: "/devguide second" });
      assert.notEqual(currentTask(dir)?.record.id, task.record.id);
      assert.equal(readEvents(task).length, 1);
    });
  });
});

describe("appendAgentEvent", () => {
  let dir: string;
  let task: OpenTask;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "devguide-agent-events-"));
    task = startTask(dir, "Export fetches only page one", "session-1", VERSION_A);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function runCommand(command: string, stdout: string, version: CodeVersion = VERSION_A): TaskEvent {
    const result = recordHookEvent(
      { hook_event_name: "PostToolUse", session_id: "session-1", cwd: dir, tool_name: "Bash", tool_input: { command }, tool_response: { stdout, stderr: "" } },
      dir,
      deps(version),
    );
    return result.events[0]!;
  }

  it("records an observation with materials marked as illustrations", () => {
    const event = appendAgentEvent(task, "observation", { text: "Only 100 of 250 rows", files: ["src/export.ts"], materials: [{ label: "sample", content: "rows: 100" }] }, deps());
    assert.equal(event.kind, "observation");
    assert.equal(event.origin, "agent");
    assert.deepEqual(event.files, ["src/export.ts"]);
    assert.deepEqual((event as { materials: unknown }).materials, [{ label: "sample", content: "rows: 100", nature: "illustration" }]);
    assert.equal(event.session_id, "session-1");
    assert.equal(readEvents(task).length, 2);
  });

  it("rejects a draft with a missing field without writing", () => {
    assert.throws(() => appendAgentEvent(task, "hypothesis", {}, deps()), (error: unknown) => error instanceof TaskLogError && /"text"/.test(error.message));
    assert.throws(() => appendAgentEvent(task, "file_changed", { path: "x", tool: "Edit" }, deps()), TaskLogError);
    assert.equal(readEvents(task).length, 1);
  });

  it("check passes only with an execution whose output contains the evidence", () => {
    const run = runCommand("npm test", "250 records written\nok\n");
    const check = appendAgentEvent(task, "check", { what: "all rows exported", expected: "250 rows", command: "npm test", evidence: "250 records written", claimed: "passed" }, deps()) as CheckEvent;
    assert.equal(check.status, "passed");
    assert.equal(check.execution_id, run.id);
    assert.equal(check.reason, null);
  });

  it("check without a recorded execution is unverified", () => {
    const check = appendAgentEvent(task, "check", { what: "x", expected: "y", command: "npm test", evidence: "ok", claimed: "passed" }, deps()) as CheckEvent;
    assert.equal(check.status, "unverified");
    assert.equal(check.reason, "no_execution");
    assert.equal(check.execution_id, null);
    assert.equal(check.claimed, "passed");
  });

  it("check whose evidence is not in the output is unverified", () => {
    const run = runCommand("npm test", "100 records written\n");
    const check = appendAgentEvent(task, "check", { what: "x", expected: "y", command: "npm test", evidence: "250 records written", claimed: "passed" }, deps()) as CheckEvent;
    assert.equal(check.status, "unverified");
    assert.equal(check.reason, "evidence_not_found");
    assert.equal(check.execution_id, run.id);
  });

  it("check without evidence is unverified even though the command ran", () => {
    runCommand("npm test", "ok\n");
    const check = appendAgentEvent(task, "check", { what: "x", expected: "y", command: "npm test", claimed: "passed" }, deps()) as CheckEvent;
    assert.equal(check.status, "unverified");
    assert.equal(check.reason, "no_evidence");
  });

  it("check matches the latest execution of the command and accepts an explicit execution id", () => {
    const first = runCommand("npm test", "first\n");
    const second = runCommand("npm test", "second\n");
    const latest = appendAgentEvent(task, "check", { what: "x", expected: "y", command: "npm test", evidence: "second", claimed: "failed" }, deps()) as CheckEvent;
    assert.equal(latest.execution_id, second.id);
    assert.equal(latest.status, "failed");
    const explicit = appendAgentEvent(task, "check", { what: "x", expected: "y", command: "npm test", evidence: "first", claimed: "passed", execution_id: first.id }, deps()) as CheckEvent;
    assert.equal(explicit.execution_id, first.id);
    assert.equal(explicit.status, "passed");
  });

  it("decision is confirmed when the quote occurs in a user prompt", () => {
    recordHookEvent({ hook_event_name: "UserPromptSubmit", session_id: "session-1", cwd: dir, prompt: "Tak, zastosuj poprawkę A" }, dir, deps());
    const prompt = readEvents(task).at(-1)!;
    const decision = appendAgentEvent(task, "decision", { question: "Apply fix A?", quote: "zastosuj poprawkę A", reading: "apply A" }, deps()) as DecisionEvent;
    assert.equal(decision.confirmed, true);
    assert.equal(decision.prompt_event_id, prompt.id);
  });

  it("decision with a quote nobody wrote is recorded as unconfirmed", () => {
    const decision = appendAgentEvent(task, "decision", { question: "Apply?", quote: "go ahead", reading: "apply" }, deps()) as DecisionEvent;
    assert.equal(decision.confirmed, false);
    assert.equal(decision.prompt_event_id, null);
    assert.equal(readEvents(task).at(-1)!.id, decision.id);
  });

  it("decision quote may come from the task description", () => {
    const decision = appendAgentEvent(task, "decision", { question: "scope?", quote: "only page one", reading: "scope is pagination" }, deps()) as DecisionEvent;
    assert.equal(decision.confirmed, true);
  });

  it("resolving a hypothesis keeps the hypothesis and adds the resolution", () => {
    const hypothesis = appendAgentEvent(task, "hypothesis", { text: "page parameter ignored" }, deps());
    const resolved = appendAgentEvent(task, "hypothesis_resolved", { hypothesis_id: hypothesis.id, outcome: "rejected", text: "the parameter is passed" }, deps());
    const kinds = readEvents(task).map((event) => event.kind);
    assert.deepEqual(kinds, ["task_started", "hypothesis", "hypothesis_resolved"]);
    assert.equal((resolved as { hypothesis_id: string }).hypothesis_id, hypothesis.id);
  });

  it("resolving an unknown hypothesis fails without writing", () => {
    assert.throws(() => appendAgentEvent(task, "hypothesis_resolved", { hypothesis_id: "nope", outcome: "confirmed", text: "x" }, deps()), /no hypothesis with id "nope"/);
    assert.equal(readEvents(task).length, 1);
  });

  it("code version of a later event differs after a change in the working tree", () => {
    const before = runCommand("npm test", "ok", VERSION_A);
    const after = runCommand("npm test", "ok", VERSION_B);
    assert.equal(before.code_version.commit, after.code_version.commit);
    assert.notEqual(before.code_version.working_tree, after.code_version.working_tree);
  });
});

describe("helpers", () => {
  it("isTaskStart and taskDescription", () => {
    assert.equal(isTaskStart("/devguide"), true);
    assert.equal(isTaskStart("  /devguide do it"), true);
    assert.equal(isTaskStart("/devguided"), false);
    assert.equal(isTaskStart("use /devguide"), false);
    assert.equal(isTaskStart(undefined), false);
    assert.equal(taskDescription("/devguide  fix it "), "fix it");
    assert.equal(taskDescription("/devguide"), "");
  });

  it("displayPath makes paths relative to the working directory with / separators", () => {
    assert.equal(displayPath("C:\\repo", "C:\\repo\\src\\a.ts"), "src/a.ts");
    assert.equal(displayPath("/repo", "/repo/src/a.ts"), "src/a.ts");
    assert.equal(displayPath("/repo", "/elsewhere/a.ts"), "/elsewhere/a.ts");
    assert.equal(displayPath(null, "src\\a.ts"), "src/a.ts");
  });

  it("task events file path is inside the task directory", () => {
    assert.match(taskEventsFile("/d", "t"), /tasks[\\/]t[\\/]events\.jsonl$/);
  });
});
