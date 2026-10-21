// The task log: one directory per DevGuide task with an append-only JSONL
// file of events. Two writers feed it: the Claude Code hook (events observed
// from tools and from the user's prompts) through `recordHookEvent`, and the
// agent's CLI (findings) through `appendAgentEvent`. The rules that keep a
// check or a decision honest live here, in the writer, not in a prompt.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, relative } from "node:path";

import { UNKNOWN_CODE_VERSION, readCodeVersion } from "./code-version.ts";
import {
  ORIGIN_OF_KIND,
  isAgentKind,
  isStringArray,
  newEventId,
  validateDraft,
  type AgentKind,
  type CheckClaim,
  type CheckEvent,
  type CodeVersion,
  type CommandRunEvent,
  type DecisionEvent,
  type Draft,
  type EventEnvelope,
  type HypothesisOutcome,
  type Material,
  type TaskEvent,
} from "./events.ts";
import { currentTaskFile, taskDir, taskEventsFile, taskFile } from "./paths.ts";
import { sessionContext, summarize } from "./replay.ts";

/** Prefix of a user prompt that starts a DevGuide task. */
export const TASK_PREFIX = "/devguide";

/** A Bash command containing this text is the agent recording a finding, not a command of the task. */
export const CLI_RECORD_MARKER = "process/cli.ts record";

export interface TaskRecord {
  id: string;
  description: string;
  /** ISO 8601 time the task was started. */
  started: string;
  /** Every Claude Code session that wrote to the task, first one first. */
  session_ids: string[];
}

export interface OpenTask {
  dataDir: string;
  record: TaskRecord;
}

export class TaskLogError extends Error {}

/** Dependencies with side effects, replaceable in tests. */
export interface TaskLogDeps {
  now: () => Date;
  codeVersion: () => CodeVersion;
}

function defaultDeps(cwd: string | null): TaskLogDeps {
  let cached: CodeVersion | null = null;
  return {
    now: () => new Date(),
    codeVersion: () => {
      cached ??= readCodeVersion(cwd);
      return cached;
    },
  };
}

// --- tasks on disk -----------------------------------------------------------

export function newTaskId(now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 13);
  return `${stamp}-${newEventId().slice(0, 4)}`;
}

export function startTask(
  dataDir: string,
  description: string,
  sessionId: string | null,
  codeVersion: CodeVersion,
  now: Date = new Date(),
): OpenTask {
  const record: TaskRecord = {
    id: newTaskId(now),
    description,
    started: now.toISOString(),
    session_ids: sessionId ? [sessionId] : [],
  };
  mkdirSync(taskDir(dataDir, record.id), { recursive: true });
  writeTaskRecord(dataDir, record);
  writeFileSync(taskEventsFile(dataDir, record.id), "", "utf8");
  writeFileSync(currentTaskFile(dataDir), `${record.id}\n`, "utf8");
  const task: OpenTask = { dataDir, record };
  appendEvent(task, {
    ...envelope(task, sessionId, codeVersion, now, []),
    kind: "task_started",
    origin: "user",
    description,
  });
  return task;
}

/** The open task of the data directory, or null when none was started. */
export function currentTask(dataDir: string): OpenTask | null {
  const pointer = currentTaskFile(dataDir);
  if (!existsSync(pointer)) return null;
  const id = readFileSync(pointer, "utf8").trim();
  if (id.length === 0) return null;
  return readTask(dataDir, id);
}

export function readTask(dataDir: string, id: string): OpenTask | null {
  const file = taskFile(dataDir, id);
  if (!existsSync(file)) return null;
  const record = JSON.parse(readFileSync(file, "utf8")) as TaskRecord;
  return { dataDir, record };
}

export function readEvents(task: OpenTask): TaskEvent[] {
  const file = taskEventsFile(task.dataDir, task.record.id);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as TaskEvent);
}

export function appendEvent(task: OpenTask, event: TaskEvent): void {
  appendFileSync(taskEventsFile(task.dataDir, task.record.id), `${JSON.stringify(event)}\n`, "utf8");
}

function writeTaskRecord(dataDir: string, record: TaskRecord): void {
  writeFileSync(taskFile(dataDir, record.id), `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

/** Remembers that `sessionId` wrote to the task. */
function noteSession(task: OpenTask, sessionId: string | null): void {
  if (!sessionId || task.record.session_ids.includes(sessionId)) return;
  task.record.session_ids.push(sessionId);
  writeTaskRecord(task.dataDir, task.record);
}

function envelope(
  task: OpenTask,
  sessionId: string | null,
  codeVersion: CodeVersion,
  now: Date,
  files: string[],
): EventEnvelope {
  return {
    id: newEventId(),
    time: now.toISOString(),
    task_id: task.record.id,
    session_id: sessionId,
    origin: "devguide",
    code_version: codeVersion,
    files,
  };
}

// --- events observed through the Claude Code hook ----------------------------

/** The part of the hook input that the task log reads. */
export interface HookInputLike {
  hook_event_name?: string;
  session_id?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: unknown;
  prompt?: string;
  source?: string;
  last_assistant_message?: string;
  error?: unknown;
  [key: string]: unknown;
}

export interface HookRecording {
  /** Events appended to the task, in order; empty when nothing applied. */
  events: TaskEvent[];
  /** Text to hand to the agent through `additionalContext`, if any. */
  context: string | null;
}

export function isTaskStart(prompt: unknown): boolean {
  if (typeof prompt !== "string") return false;
  const trimmed = prompt.trimStart();
  return trimmed === TASK_PREFIX || trimmed.startsWith(`${TASK_PREFIX} `) || trimmed.startsWith(`${TASK_PREFIX}\n`);
}

export function taskDescription(prompt: string): string {
  return prompt.trimStart().slice(TASK_PREFIX.length).trim();
}

/**
 * Turns one hook input into task events. Starts a task on `/devguide`;
 * otherwise appends to the open task, or does nothing when there is none.
 */
export function recordHookEvent(input: HookInputLike, dataDir: string, deps?: TaskLogDeps): HookRecording {
  const d = deps ?? defaultDeps(typeof input.cwd === "string" ? input.cwd : null);
  const sessionId = typeof input.session_id === "string" ? input.session_id : null;
  const event = input.hook_event_name;

  if (event === "UserPromptSubmit" && isTaskStart(input.prompt)) {
    const task = startTask(dataDir, taskDescription(input.prompt as string), sessionId, d.codeVersion(), d.now());
    return { events: readEvents(task), context: null };
  }

  const task = currentTask(dataDir);
  if (!task) return { events: [], context: null };

  const build = (files: string[]): EventEnvelope => envelope(task, sessionId, d.codeVersion(), d.now(), files);
  let created: TaskEvent | null = null;
  let context: string | null = null;

  switch (event) {
    case "UserPromptSubmit":
      if (typeof input.prompt === "string" && input.prompt.trim().length > 0) {
        created = { ...build([]), kind: "user_prompt", origin: "user", text: input.prompt };
      }
      break;
    case "PostToolUse":
      created = fromToolUse(input, build);
      break;
    case "PostToolUseFailure":
      created = {
        ...build(filesOf(input)),
        kind: "tool_failed",
        origin: "tool",
        tool: input.tool_name ?? "unknown",
        input: input.tool_input ?? null,
        error: input.error ?? null,
      };
      break;
    case "Stop":
      if (typeof input.last_assistant_message === "string" && input.last_assistant_message.length > 0) {
        created = { ...build([]), kind: "agent_message", origin: "agent", text: input.last_assistant_message };
      }
      break;
    case "SessionStart": {
      created = { ...build([]), kind: "session_resumed", origin: "devguide", source: input.source ?? "unknown" };
      break;
    }
    default:
      break;
  }

  if (!created) return { events: [], context: null };
  noteSession(task, sessionId);
  appendEvent(task, created);
  if (event === "SessionStart") {
    context = sessionContext(summarize(task.record, readEvents(task)));
  }
  return { events: [created], context };
}

function fromToolUse(input: HookInputLike, build: (files: string[]) => EventEnvelope): TaskEvent | null {
  const response = (typeof input.tool_response === "object" && input.tool_response !== null ? input.tool_response : {}) as Record<
    string,
    unknown
  >;
  const toolInput = input.tool_input ?? {};
  const cwd = typeof input.cwd === "string" ? input.cwd : null;

  if (input.tool_name === "Write" || input.tool_name === "Edit") {
    const rawPath = firstString(response["filePath"], toolInput["file_path"]);
    if (rawPath === null) return null;
    const path = displayPath(cwd, rawPath);
    const isWrite = input.tool_name === "Write";
    const original = typeof response["originalFile"] === "string" ? response["originalFile"] : null;
    const created = isWrite ? response["type"] === "create" || (response["type"] === undefined && original === null) : false;
    return {
      ...build([path]),
      kind: "file_changed",
      origin: "tool",
      path,
      created,
      before: isWrite ? original : firstString(response["oldString"], toolInput["old_string"]),
      after: isWrite ? firstString(response["content"], toolInput["content"]) : firstString(response["newString"], toolInput["new_string"]),
      patch: response["structuredPatch"] ?? null,
      tool: input.tool_name,
    };
  }

  if (input.tool_name === "Bash") {
    const command = firstString(toolInput["command"]);
    if (command === null || command.includes(CLI_RECORD_MARKER)) return null;
    return {
      ...build([]),
      kind: "command_run",
      origin: "tool",
      command,
      stdout: firstString(response["stdout"]) ?? "",
      stderr: firstString(response["stderr"]) ?? "",
      interrupted: response["interrupted"] === true,
      exit_code: typeof response["exit_code"] === "number" ? response["exit_code"] : null,
    };
  }

  return null;
}

function filesOf(input: HookInputLike): string[] {
  const path = firstString(input.tool_input?.["file_path"]);
  return path === null ? [] : [displayPath(typeof input.cwd === "string" ? input.cwd : null, path)];
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) if (typeof value === "string") return value;
  return null;
}

/** A path relative to the working directory with `/` separators, or unchanged when outside it. */
export function displayPath(cwd: string | null, path: string): string {
  if (cwd && isAbsolute(path)) {
    const rel = relative(cwd, path);
    if (rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel)) return rel.replaceAll("\\", "/");
  }
  return path.replaceAll("\\", "/");
}

// --- findings recorded by the agent -----------------------------------------

/**
 * Appends a finding of the agent after applying the rules of the log:
 * a check is `passed` only with a recorded execution whose output contains
 * the evidence; a decision is confirmed only by a quote found in a user
 * prompt; a resolution needs an existing hypothesis. Throws TaskLogError
 * on a draft that cannot be recorded at all.
 */
export function appendAgentEvent(task: OpenTask, kind: string, draft: Draft, deps?: TaskLogDeps): TaskEvent {
  if (!isAgentKind(kind)) {
    throw new TaskLogError(`"${kind}" is not a kind the agent can record (use one of: observation, hypothesis, hypothesis_resolved, proposal, change_prepared, decision, check)`);
  }
  const problems = validateDraft(kind, draft);
  if (problems.length > 0) throw new TaskLogError(problems.join("; "));

  const d = deps ?? defaultDeps(null);
  const existing = readEvents(task);
  const sessionId = task.record.session_ids.at(-1) ?? null;
  const files = isStringArray(draft["files"]) ? draft["files"] : [];
  const base = { ...envelope(task, sessionId, d.codeVersion(), d.now(), files), origin: ORIGIN_OF_KIND[kind] as "agent" };
  const materials = asIllustrations(draft["materials"]);
  const text = (field: string): string => String(draft[field] ?? "");

  let event: TaskEvent;
  switch (kind as AgentKind) {
    case "observation":
      event = { ...base, kind: "observation", text: text("text"), materials };
      break;
    case "hypothesis":
      event = { ...base, kind: "hypothesis", text: text("text") };
      break;
    case "hypothesis_resolved": {
      const hypothesisId = text("hypothesis_id");
      if (!existing.some((item) => item.kind === "hypothesis" && item.id === hypothesisId)) {
        throw new TaskLogError(`no hypothesis with id "${hypothesisId}" in task ${task.record.id}`);
      }
      event = { ...base, kind: "hypothesis_resolved", hypothesis_id: hypothesisId, outcome: text("outcome") as HypothesisOutcome, text: text("text") };
      break;
    }
    case "proposal":
      event = { ...base, kind: "proposal", text: text("text"), materials };
      break;
    case "change_prepared":
      event = { ...base, kind: "change_prepared", text: text("text"), patch: typeof draft["patch"] === "string" ? draft["patch"] : null, materials };
      break;
    case "decision":
      event = resolveDecision({ ...base, kind: "decision", question: text("question"), quote: text("quote"), reading: text("reading"), confirmed: false, prompt_event_id: null }, existing);
      break;
    case "check":
      event = resolveCheck(
        {
          ...base,
          kind: "check",
          what: text("what"),
          expected: text("expected"),
          command: text("command"),
          evidence: text("evidence"),
          claimed: text("claimed") as CheckClaim,
          status: "unverified",
          execution_id: null,
          reason: null,
        },
        typeof draft["execution_id"] === "string" ? draft["execution_id"] : null,
        existing,
      );
      break;
  }

  appendEvent(task, event);
  return event;
}

function asIllustrations(value: unknown): Material[] {
  if (!Array.isArray(value)) return [];
  return value.map((item: { label: string; content: string }) => ({ label: item.label, content: item.content, nature: "illustration" }));
}

/** Finds the execution the check refers to and derives the status from it. */
export function resolveCheck(check: CheckEvent, executionId: string | null, events: TaskEvent[]): CheckEvent {
  const runs = events.filter((item): item is CommandRunEvent => item.kind === "command_run");
  const execution = executionId
    ? runs.find((run) => run.id === executionId)
    : runs.findLast((run) => run.command.trim() === check.command.trim());
  if (!execution) return { ...check, status: "unverified", execution_id: null, reason: "no_execution" };
  if (check.evidence.trim().length === 0) return { ...check, status: "unverified", execution_id: execution.id, reason: "no_evidence" };
  if (!`${execution.stdout}\n${execution.stderr}`.includes(check.evidence)) {
    return { ...check, status: "unverified", execution_id: execution.id, reason: "evidence_not_found" };
  }
  return { ...check, status: check.claimed, execution_id: execution.id, reason: null };
}

/** Marks the decision confirmed when the quote occurs in what the user actually wrote. */
export function resolveDecision(decision: DecisionEvent, events: TaskEvent[]): DecisionEvent {
  const quote = decision.quote.trim();
  const source = events.findLast(
    (item) =>
      (item.kind === "user_prompt" && item.text.includes(quote)) ||
      (item.kind === "task_started" && item.description.includes(quote)),
  );
  return source ? { ...decision, confirmed: true, prompt_event_id: source.id } : { ...decision, confirmed: false, prompt_event_id: null };
}

export { UNKNOWN_CODE_VERSION };
