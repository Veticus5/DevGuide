// Claude Code hook that appends one JSON line per hook event to a local
// activity log. One script serves every hook event: the event name comes
// from the `hook_event_name` field that Claude Code puts on stdin.
//
// Behaviour:
// - Every event is written to DEVGUIDE_LOG_FILE, or to
//   <cwd>/.devguide/events.jsonl when the variable is not set.
// - A failed write never blocks the agent: the error goes to stderr and the
//   process still exits with 0.
// - PreToolUse for a Bash command containing BLOCK_MARKER answers with a
//   `deny` decision (JSON on stdout) after recording the refusal. Nothing
//   else is ever blocked.
//
// Usage (configured in a Claude Code settings file):
//   {"type": "command", "command": "node", "args": ["agent/hooks/record-event.ts"]}

import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

/** A Bash command containing this text is refused before it runs. */
export const BLOCK_MARKER = "devguide-block-me";

/** Prefix of a user prompt that starts a DevGuide task. */
export const TASK_PREFIX = "/devguide";

export const DEFAULT_LOG_DIRECTORY = ".devguide";
export const DEFAULT_LOG_FILE = "events.jsonl";

/** The JSON Claude Code sends on stdin. Only the fields the hook reads are typed. */
export interface HookInput {
  hook_event_name?: string;
  session_id?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  prompt?: string;
  [key: string]: unknown;
}

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

export function isTaskStart(prompt: unknown): boolean {
  if (typeof prompt !== "string") return false;
  const trimmed = prompt.trimStart();
  return trimmed === TASK_PREFIX || trimmed.startsWith(`${TASK_PREFIX} `) || trimmed.startsWith(`${TASK_PREFIX}\n`);
}

export function shouldBlock(input: HookInput): boolean {
  if (input.tool_name !== "Bash") return false;
  const command = input.tool_input?.["command"];
  return typeof command === "string" && command.includes(BLOCK_MARKER);
}

/** Resolves the log file: the environment variable wins, otherwise `<cwd>/.devguide/events.jsonl`. */
export function resolveLogFile(env: NodeJS.ProcessEnv, cwd: string | null): string {
  const fromEnv = env["DEVGUIDE_LOG_FILE"];
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return join(cwd ?? process.cwd(), DEFAULT_LOG_DIRECTORY, DEFAULT_LOG_FILE);
}

/** Current commit of the repository that contains `cwd`, or null when there is none. */
export function readCodeVersion(cwd: string | null): string | null {
  try {
    const output = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: cwd ?? process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
    });
    const version = output.trim();
    return version.length > 0 ? version : null;
  } catch {
    return null;
  }
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
  const result = handleHookInput(input, new Date(), readCodeVersion(cwd));

  try {
    appendEntry(resolveLogFile(process.env, cwd), result.entry);
  } catch (error) {
    process.stderr.write(`record-event: could not write log: ${String(error)}\n`);
  }

  if (result.stdout) {
    process.stdout.write(`${JSON.stringify(result.stdout)}\n`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
