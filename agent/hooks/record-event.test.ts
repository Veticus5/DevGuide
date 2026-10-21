import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  BLOCK_MARKER,
  handleHookInput,
  isTaskStart,
  resolveLogFile,
  shouldBlock,
  type LogEntry,
} from "./record-event.ts";

const SCRIPT = fileURLToPath(new URL("./record-event.ts", import.meta.url));

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
  entries: LogEntry[];
}

/** Runs the hook as Claude Code would: JSON on stdin, log path in the environment. */
function runHook(input: Record<string, unknown>, logFile: string, cwd: string): RunResult {
  const result = spawnSync(process.execPath, [SCRIPT], {
    cwd,
    input: JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, DEVGUIDE_LOG_FILE: logFile },
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
    // A regular file where the log directory should be makes mkdir fail.
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
      env: { ...process.env, DEVGUIDE_LOG_FILE: logFile },
    });
    assert.equal(result.status, 0);
    assert.match(result.stderr, /could not parse/);
  });
});

describe("record-event helpers", () => {
  it("resolveLogFile prefers the environment variable", () => {
    assert.equal(resolveLogFile({ DEVGUIDE_LOG_FILE: "/tmp/x.jsonl" }, "/repo"), "/tmp/x.jsonl");
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
