import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, it } from "node:test";

import type { FileChangedEvent } from "../../process/events.ts";
import { currentTask, readEvents, startTask } from "../../process/task-log.ts";
import {
  BLOCK_MARKER,
  handleHookInput,
  isTaskStart,
  resolveLogFile,
  shouldBlock,
  type LogEntry,
} from "./record-event.ts";

const SCRIPT = fileURLToPath(new URL("./record-event.ts", import.meta.url));
const NO_VERSION = { commit: null, working_tree: null };

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
  entries: LogEntry[];
}

/** Runs the hook as Claude Code would: JSON on stdin, data directory in the environment. The log is `<dir>/events.jsonl`. */
function runHook(input: Record<string, unknown>, logFile: string, cwd: string): RunResult {
  const result = spawnSync(process.execPath, [SCRIPT], {
    cwd,
    input: JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, DEVGUIDE_DIR: dirname(logFile) },
  });
  const entries = existsSync(logFile)
    ? readFileSync(logFile, "utf8")
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as LogEntry)
    : [];
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, entries };
}

describe("record-event hook (as a child process)", () => {
  let dir: string;
  let logFile: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "devguide-hook-"));
    logFile = join(dir, "log", "events.jsonl");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("records a PostToolUse event with the full tool payload", () => {
    const run = runHook(
      {
        hook_event_name: "PostToolUse",
        session_id: "session-1",
        cwd: dir,
        tool_name: "Write",
        tool_input: { file_path: "hello.txt", content: "hi" },
        tool_response: { filePath: "hello.txt", type: "create" },
      },
      logFile,
      dir,
    );
    assert.equal(run.status, 0);
    assert.equal(run.stdout, "");
    assert.equal(run.entries.length, 1);
    const entry = run.entries[0]!;
    assert.equal(entry.event, "PostToolUse");
    assert.equal(entry.source, "hook");
    assert.equal(entry.session_id, "session-1");
    assert.equal(entry.cwd, dir);
    assert.match(entry.time, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(entry.payload, {
      tool_name: "Write",
      tool_input: { file_path: "hello.txt", content: "hi" },
      tool_response: { filePath: "hello.txt", type: "create" },
    });
  });

  it("marks the Stop event as text from the agent", () => {
    const run = runHook(
      { hook_event_name: "Stop", session_id: "s", cwd: dir, last_assistant_message: "Done." },
      logFile,
      dir,
    );
    assert.equal(run.status, 0);
    assert.equal(run.entries[0]!.source, "agent");
    assert.equal(run.entries[0]!.payload["last_assistant_message"], "Done.");
  });

  it("keeps the SessionStart source so a resume is distinguishable", () => {
    const run = runHook({ hook_event_name: "SessionStart", session_id: "s", cwd: dir, source: "resume" }, logFile, dir);
    assert.equal(run.status, 0);
    assert.equal(run.entries[0]!.event, "SessionStart");
    assert.equal(run.entries[0]!.payload["source"], "resume");
  });

  it("denies a Bash command with the block marker and records the refusal", () => {
    const command = `echo ${BLOCK_MARKER} > blocked.txt`;
    const run = runHook(
      { hook_event_name: "PreToolUse", session_id: "s", cwd: dir, tool_name: "Bash", tool_input: { command } },
      logFile,
      dir,
    );
    assert.equal(run.status, 0);
    const decision = JSON.parse(run.stdout) as {
      hookSpecificOutput: { hookEventName: string; permissionDecision: string; permissionDecisionReason: string };
    };
    assert.equal(decision.hookSpecificOutput.hookEventName, "PreToolUse");
    assert.equal(decision.hookSpecificOutput.permissionDecision, "deny");
    assert.match(decision.hookSpecificOutput.permissionDecisionReason, /DevGuide/);
    assert.equal(run.entries.length, 1);
    assert.equal(run.entries[0]!.kind, "blocked");
    assert.equal((run.entries[0]!.payload["tool_input"] as { command: string }).command, command);
  });

  it("prints no decision for a Bash command without the marker", () => {
    const run = runHook(
      { hook_event_name: "PreToolUse", session_id: "s", cwd: dir, tool_name: "Bash", tool_input: { command: "echo ok" } },
      logFile,
      dir,
    );
    assert.equal(run.status, 0);
    assert.equal(run.stdout, "");
    assert.equal(run.entries[0]!.kind, undefined);
  });

  it("marks a /devguide prompt as the start of a task", () => {
    const run = runHook(
      { hook_event_name: "UserPromptSubmit", session_id: "s", cwd: dir, prompt: "/devguide fix the export" },
      logFile,
      dir,
    );
    assert.equal(run.status, 0);
    assert.equal(run.entries[0]!.kind, "task_started");
    assert.equal(run.entries[0]!.payload["prompt"], "/devguide fix the export");
  });

  it("does not mark an ordinary prompt as a task start", () => {
    const run = runHook(
      { hook_event_name: "UserPromptSubmit", session_id: "s", cwd: dir, prompt: "tell me about devguide" },
      logFile,
      dir,
    );
    assert.equal(run.entries[0]!.kind, undefined);
  });

  it("records a null code version outside a Git repository", () => {
    const run = runHook({ hook_event_name: "SessionStart", session_id: "s", cwd: dir, source: "startup" }, logFile, dir);
    assert.equal(run.status, 0);
    assert.equal(run.entries[0]!.code_version, null);
  });

  it("records the current commit inside a Git repository", () => {
    const git = (...args: string[]) =>
      spawnSync("git", args, { cwd: dir, encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" } });
    git("init", "-q");
    git("-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init");
    const head = git("rev-parse", "HEAD").stdout.trim();
    assert.match(head, /^[0-9a-f]{40}$/);
    const run = runHook({ hook_event_name: "SessionStart", session_id: "s", cwd: dir, source: "startup" }, logFile, dir);
    assert.equal(run.entries[0]!.code_version, head);
  });

  it("exits 0 and reports on stderr when the log cannot be written", () => {
    // A regular file where the data directory should be makes mkdir fail.
    const blocker = join(dir, "not-a-directory");
    writeFileSync(blocker, "x");
    const run = runHook(
      { hook_event_name: "PostToolUse", session_id: "s", cwd: dir, tool_name: "Read", tool_input: {} },
      join(blocker, "events.jsonl"),
      dir,
    );
    assert.equal(run.status, 0);
    assert.match(run.stderr, /could not write log/);
  });

  it("still exits 0 on malformed input", () => {
    const result = spawnSync(process.execPath, [SCRIPT], {
      cwd: dir,
      input: "not json",
      encoding: "utf8",
      env: { ...process.env, DEVGUIDE_DIR: dirname(logFile) },
    });
    assert.equal(result.status, 0);
    assert.match(result.stderr, /could not parse/);
  });
});

describe("record-event hook and the task log", () => {
  let dir: string;
  let dataDir: string;
  let logFile: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "devguide-hook-task-"));
    dataDir = join(dir, "data");
    logFile = join(dataDir, "events.jsonl");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("a /devguide prompt opens a task next to the raw log entry", () => {
    const run = runHook(
      { hook_event_name: "UserPromptSubmit", session_id: "s", cwd: dir, prompt: "/devguide fix the export" },
      logFile,
      dir,
    );
    assert.equal(run.status, 0);
    assert.equal(run.stdout, "");
    assert.equal(run.entries[0]!.kind, "task_started");
    const task = currentTask(dataDir);
    assert.equal(task?.record.description, "fix the export");
    assert.deepEqual(task?.record.session_ids, ["s"]);
    const events = readEvents(task!);
    assert.equal(events.length, 1);
    assert.equal(events[0]!.kind, "task_started");
    assert.equal(events[0]!.code_version.commit, null);
  });

  it("an Edit in an open task becomes a file_changed event", () => {
    const task = startTask(dataDir, "t", "s", NO_VERSION);
    const path = join(dir, "hello.txt");
    runHook(
      {
        hook_event_name: "PostToolUse",
        session_id: "s",
        cwd: dir,
        tool_name: "Edit",
        tool_input: { file_path: path, old_string: "hello", new_string: "greetings" },
        tool_response: { filePath: path, oldString: "hello", newString: "greetings", originalFile: "hello x", structuredPatch: [] },
      },
      logFile,
      dir,
    );
    const last = readEvents(task).at(-1) as FileChangedEvent;
    assert.equal(last.kind, "file_changed");
    assert.equal(last.path, "hello.txt");
    assert.equal(last.before, "hello");
    assert.equal(last.after, "greetings");
  });

  it("a SessionEnd with an open task appends session_ended and answers nothing", () => {
    const task = startTask(dataDir, "t", "s1", NO_VERSION);
    const run = runHook({ hook_event_name: "SessionEnd", session_id: "s1", cwd: dir, reason: "other" }, logFile, dir);
    assert.equal(run.status, 0);
    assert.equal(run.stdout.trim(), "");
    const last = readEvents(task).at(-1)!;
    assert.equal(last.kind, "session_ended");
    assert.equal((last as { reason: string }).reason, "other");
    assert.equal(run.entries[0]!.event, "SessionEnd");
  });

  it("a SessionStart with an open task answers with additionalContext naming the task", () => {
    const task = startTask(dataDir, "t", "s1", NO_VERSION);
    const run = runHook({ hook_event_name: "SessionStart", session_id: "s2", cwd: dir, source: "resume" }, logFile, dir);
    assert.equal(run.status, 0);
    const output = JSON.parse(run.stdout) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
    assert.equal(output.hookSpecificOutput.hookEventName, "SessionStart");
    assert.match(output.hookSpecificOutput.additionalContext, new RegExp(`DevGuide task ${task.record.id} is open`));
    assert.equal(readEvents(task).at(-1)!.kind, "session_resumed");
    assert.equal(run.entries[0]!.event, "SessionStart");
  });

  it("a SessionStart without a task prints nothing", () => {
    const run = runHook({ hook_event_name: "SessionStart", session_id: "s", cwd: dir, source: "startup" }, logFile, dir);
    assert.equal(run.stdout, "");
    assert.equal(existsSync(join(dataDir, "tasks")), false);
  });

  it("exits 0 and reports on stderr when the task directory cannot be written", () => {
    // A regular file named `tasks` makes creating the task directory fail; the raw log still works.
    runHook({ hook_event_name: "SessionStart", session_id: "s", cwd: dir, source: "startup" }, logFile, dir);
    writeFileSync(join(dataDir, "tasks"), "x");
    const run = runHook(
      { hook_event_name: "UserPromptSubmit", session_id: "s", cwd: dir, prompt: "/devguide fix the export" },
      logFile,
      dir,
    );
    assert.equal(run.status, 0);
    assert.match(run.stderr, /could not record task event/);
    assert.equal(run.entries.length, 2);
    assert.equal(run.entries[1]!.kind, "task_started");
  });
});

describe("record-event helpers", () => {
  it("resolveLogFile uses DEVGUIDE_DIR or .devguide under the working directory", () => {
    assert.equal(resolveLogFile({ DEVGUIDE_DIR: "/tmp/dg" }, "/repo"), join("/tmp/dg", "events.jsonl"));
    assert.equal(resolveLogFile({}, "/repo"), join("/repo", ".devguide", "events.jsonl"));
  });

  it("isTaskStart accepts the bare command and the command with arguments", () => {
    assert.equal(isTaskStart("/devguide"), true);
    assert.equal(isTaskStart("  /devguide do it"), true);
    assert.equal(isTaskStart("/devguided"), false);
    assert.equal(isTaskStart("use /devguide"), false);
    assert.equal(isTaskStart(undefined), false);
  });

  it("shouldBlock only matches Bash commands with the marker", () => {
    assert.equal(shouldBlock({ tool_name: "Bash", tool_input: { command: `x ${BLOCK_MARKER}` } }), true);
    assert.equal(shouldBlock({ tool_name: "Write", tool_input: { content: BLOCK_MARKER } }), false);
    assert.equal(shouldBlock({ tool_name: "Bash", tool_input: { command: "echo ok" } }), false);
  });

  it("handleHookInput labels unknown events without failing", () => {
    const { entry, stdout } = handleHookInput({}, new Date(0), null);
    assert.equal(entry.event, "unknown");
    assert.equal(entry.time, "1970-01-01T00:00:00.000Z");
    assert.equal(stdout, undefined);
  });
});
