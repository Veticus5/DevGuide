// Where DevGuide keeps its data: one directory, `.devguide/` in the working
// directory by default, or whatever DEVGUIDE_DIR names. Both the Claude Code
// hook and the agent's CLI call resolve the same directory because both
// inherit the environment of the `claude` process.

import { join } from "node:path";

export const DEFAULT_DATA_DIRECTORY = ".devguide";
export const RAW_LOG_FILE = "events.jsonl";
export const TASKS_DIRECTORY = "tasks";
export const CURRENT_TASK_FILE = "current-task";
export const TASK_FILE = "task.json";
export const TASK_EVENTS_FILE = "events.jsonl";

export function resolveDataDir(env: NodeJS.ProcessEnv, cwd: string | null): string {
  const fromEnv = env["DEVGUIDE_DIR"];
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return join(cwd ?? process.cwd(), DEFAULT_DATA_DIRECTORY);
}

/** The raw hook log: every hook event, unchanged payload. */
export function rawLogFile(dataDir: string): string {
  return join(dataDir, RAW_LOG_FILE);
}

export function tasksDir(dataDir: string): string {
  return join(dataDir, TASKS_DIRECTORY);
}

/** Text file holding the id of the open task. */
export function currentTaskFile(dataDir: string): string {
  return join(dataDir, CURRENT_TASK_FILE);
}

export function taskDir(dataDir: string, taskId: string): string {
  return join(tasksDir(dataDir), taskId);
}

export function taskFile(dataDir: string, taskId: string): string {
  return join(taskDir(dataDir, taskId), TASK_FILE);
}

export function taskEventsFile(dataDir: string, taskId: string): string {
  return join(taskDir(dataDir, taskId), TASK_EVENTS_FILE);
}
