// Claude Code hook that appends one JSON line per hook event to a local
// activity log and feeds the DevGuide task log. One script serves every hook
// event: the event name comes from the `hook_event_name` field that Claude
// Code puts on stdin.
//
// Behaviour:
// - Every event is written to <DEVGUIDE_DIR>/events.jsonl, or to
//   <cwd>/.devguide/events.jsonl when the variable is not set.
// - When a DevGuide task is open (or the prompt is `/devguide ...`), the
//   event is also turned into task events by `process/task-log.ts`.
// - A SessionStart with an open task answers with `additionalContext`
//   describing the task, so the agent knows where it stands.
// - A failed write never blocks the agent: the error goes to stderr and the
//   process still exits with 0.
// - PreToolUse for a Bash command containing BLOCK_MARKER answers with a
//   `deny` decision (JSON on stdout) after recording the refusal. Nothing
//   else is ever blocked.
//
// Usage (configured in a Claude Code settings file):
//   {"type": "command", "command": "node", "args": ["agent/hooks/record-event.ts"]}

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

import { readCommit, readWorkingTree } from "../../process/code-version.ts";
import { rawLogFile, resolveDataDir } from "../../process/paths.ts";
import { isTaskStart, recordHookEvent, type HookInputLike, type TaskLogDeps } from "../../process/task-log.ts";

export { isTaskStart };

/** A Bash command containing this text is refused before it runs. */
export const BLOCK_MARKER = "devguide-block-me";

/** The JSON Claude Code sends on stdin. Only the fields the hook reads are typed. */
export type HookInput = HookInputLike;

/** One line of the activity log. */
export interface LogEntry {
  /** ISO 8601 time at which the hook ran. */
  time: string;
  session_id: string | null;
  /** Hook event name, for example `PostToolUse`. */
  event: string;
  /** `hook` for observations made by Claude Code tools, `agent` for text written by the agent. */
  source: "hook" | "agent";
  /** Commit the working directory was at, or null when unknown. */
  code_version: string | null;
  cwd: string | null;
  /** Set on events the hook classifies: `task_started`, `blocked`. */
  kind?: "task_started" | "blocked";
  /** The hook input without the fields already lifted to the top level. */
  payload: Record<string, unknown>;
}

/** Decision returned to Claude Code for a PreToolUse event. */
export interface PreToolUseDecision {
  hookSpecificOutput: {
    hookEventName: "PreToolUse";
    permissionDecision: "deny";
    permissionDecisionReason: string;
  };
}

/** Context returned to Claude Code for a SessionStart event. */
export interface SessionStartContext {
  hookSpecificOutput: {
    hookEventName: "SessionStart";
    additionalContext: string;
  };
}

export interface HookResult {
  entry: LogEntry;
  /** JSON to print on stdout, if any. */
  stdout?: PreToolUseDecision;
}

/** Builds the log entry and the decision for one hook input. Pure apart from `now` and `codeVersion`. */
export function handleHookInput(
  input: HookInput,
  now: Date,
  codeVersion: string | null,
): HookResult {
  const { hook_event_name, session_id, cwd, ...rest } = input;
  const event = typeof hook_event_name === "string" ? hook_event_name : "unknown";
  const entry: LogEntry = {
    time: now.toISOString(),
    session_id: typeof session_id === "string" ? session_id : null,
    event,
    source: event === "Stop" || event === "SubagentStop" ? "agent" : "hook",
    code_version: codeVersion,
    cwd: typeof cwd === "string" ? cwd : null,
    payload: rest,
  };

  if (event === "UserPromptSubmit" && isTaskStart(input.prompt)) {
    entry.kind = "task_started";
  }

  if (event === "PreToolUse" && shouldBlock(input)) {
    entry.kind = "blocked";
    const reason =
      `DevGuide blocked this command because it contains "${BLOCK_MARKER}". ` +
      "This is the stage 2 integration experiment: the command was not run. Do not retry it.";
    return {
      entry,
      stdout: {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: reason,
        },
      },
    };
  }

  return { entry };
}

export function shouldBlock(input: HookInput): boolean {
  if (input.tool_name !== "Bash") return false;
  const command = input.tool_input?.["command"];
  return typeof command === "string" && command.includes(BLOCK_MARKER);
}

/** Resolves the raw log file: `<DEVGUIDE_DIR or <cwd>/.devguide>/events.jsonl`. */
export function resolveLogFile(env: NodeJS.ProcessEnv, cwd: string | null): string {
  return rawLogFile(resolveDataDir(env, cwd));
}

export function appendEntry(logFile: string, entry: LogEntry): void {
  mkdirSync(dirname(logFile), { recursive: true });
  appendFileSync(logFile, `${JSON.stringify(entry)}\n`, "utf8");
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function main(): Promise<number> {
  let input: HookInput = {};
  try {
    const raw = await readStdin();
    input = raw.trim().length > 0 ? (JSON.parse(raw) as HookInput) : {};
  } catch (error) {
    process.stderr.write(`record-event: could not parse hook input: ${String(error)}\n`);
  }

  const cwd = typeof input.cwd === "string" ? input.cwd : null;
  const commit = readCommit(cwd);
  const result = handleHookInput(input, new Date(), commit);
  const dataDir = resolveDataDir(process.env, cwd);

  try {
    appendEntry(rawLogFile(dataDir), result.entry);
  } catch (error) {
    process.stderr.write(`record-event: could not write log: ${String(error)}\n`);
  }

  if (result.stdout) {
    process.stdout.write(`${JSON.stringify(result.stdout)}\n`);
    return 0;
  }

  // The working-tree fingerprint costs a few git calls, so it is computed
  // only when a task event is actually created.
  let workingTree: string | null | undefined;
  const deps: TaskLogDeps = {
    now: () => new Date(),
    codeVersion: () => {
      if (workingTree === undefined) workingTree = commit === null ? null : readWorkingTree(cwd);
      return { commit, working_tree: workingTree };
    },
  };
  try {
    const recording = recordHookEvent(input, dataDir, deps);
    if (recording.context !== null) {
      const output: SessionStartContext = {
        hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: recording.context },
      };
      process.stdout.write(`${JSON.stringify(output)}\n`);
    }
  } catch (error) {
    process.stderr.write(`record-event: could not record task event: ${String(error)}\n`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
