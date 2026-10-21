// Command-line entry to the task log. The agent records findings with it
// (`record <kind>`), the user and the agent read the task back with it
// (`replay`, `status`). Data directory: DEVGUIDE_DIR or ./.devguide.
//
// Usage:
//   node process/cli.ts record <kind> [options]
//   node process/cli.ts replay [--json] [--event <id>]
//   node process/cli.ts status [--json]
//   node process/cli.ts --help
//
// Exit codes: 0 done, 1 refused (no open task, missing field, unknown id),
// 2 usage error.

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

import { AGENT_KINDS, type Draft, type Material } from "./events.ts";
import { resolveDataDir } from "./paths.ts";
import { formatEvent, formatSummary, formatTimeline, summarize } from "./replay.ts";
import { TaskLogError, appendAgentEvent, currentTask, readEvents } from "./task-log.ts";

export const HELP = `DevGuide task log

Usage:
  node process/cli.ts record <kind> [options]   record a finding of the agent in the open task
  node process/cli.ts replay [--json] [--event <id>]   print the course of the open task
  node process/cli.ts status [--json]           print the state of the open task
  node process/cli.ts --help

Kinds and their options (every text option takes one quoted string):
  observation          --text <what was observed>
  hypothesis           --text <what is assumed>
  hypothesis_resolved  --hypothesis <id> --outcome confirmed|rejected --text <why>
  proposal             --text <proposed solution>
  change_prepared      --text <what the change does> [--patch-file <path>]
  decision             --question <what was asked> --quote <the user's exact words> --reading <what it means>
  check                --what <plain-language description> --expected <expectation>
                       --command <exact command that was run> --evidence <text quoted from its output>
                       --claimed passed|failed|inconclusive [--execution <command_run event id>]

Common options:
  --files <a,b,c>                  related paths
  --material "<label>=<text>"      an example from the agent (repeatable; always an illustration)
  --material-file "<label>=<path>" same, content read from a file

Rules applied on record:
  - a check is "passed" only when the command was run in this task and the evidence occurs in its output;
    otherwise it is recorded as "unverified" with the reason;
  - a decision is "confirmed" only when the quote occurs in something the user wrote in this task;
  - a resolution needs an existing hypothesis id.

Environment: DEVGUIDE_DIR (default ./.devguide).
`;

const RECORD_OPTIONS = {
  text: { type: "string" },
  files: { type: "string" },
  material: { type: "string", multiple: true },
  "material-file": { type: "string", multiple: true },
  hypothesis: { type: "string" },
  outcome: { type: "string" },
  "patch-file": { type: "string" },
  question: { type: "string" },
  quote: { type: "string" },
  reading: { type: "string" },
  what: { type: "string" },
  expected: { type: "string" },
  command: { type: "string" },
  evidence: { type: "string" },
  claimed: { type: "string" },
  execution: { type: "string" },
} as const;

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env: NodeJS.ProcessEnv;
  cwd: string;
}

export function run(argv: string[], io: CliIo): number {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h" || command === "help") {
    io.stdout(HELP);
    return command ? 0 : 2;
  }
  const dataDir = resolveDataDir(io.env, io.cwd);
  try {
    switch (command) {
      case "record":
        return record(rest, dataDir, io);
      case "replay":
        return replay(rest, dataDir, io);
      case "status":
        return status(rest, dataDir, io);
      default:
        io.stderr(`unknown command "${command}"\n\n${HELP}`);
        return 2;
    }
  } catch (error) {
    if (error instanceof TaskLogError) {
      io.stderr(`error: ${error.message}\n`);
      return 1;
    }
    throw error;
  }
}

function record(args: string[], dataDir: string, io: CliIo): number {
  const [kind, ...optionArgs] = args;
  if (!kind || kind.startsWith("-")) {
    io.stderr(`error: record needs a kind: ${AGENT_KINDS.join(", ")}\n`);
    return 2;
  }
  let values: Record<string, string | string[] | undefined>;
  try {
    values = parseArgs({ args: optionArgs, options: RECORD_OPTIONS, strict: true, allowPositionals: false }).values;
  } catch (error) {
    io.stderr(`error: ${(error as Error).message}\n`);
    return 2;
  }
  const task = currentTask(dataDir);
  if (!task) {
    io.stderr(`error: no open task in ${dataDir} (start one with /devguide in Claude Code)\n`);
    return 1;
  }
  const draft = draftFromOptions(values);
  const event = appendAgentEvent(task, kind, draft);
  io.stdout(`recorded ${event.kind} ${event.id}\n`);
  return 0;
}

export function draftFromOptions(values: Record<string, string | string[] | undefined>): Draft {
  const text = (name: string): string | undefined => (typeof values[name] === "string" ? (values[name] as string) : undefined);
  const draft: Draft = {};
  const copy: Record<string, string> = {
    text: "text",
    question: "question",
    quote: "quote",
    reading: "reading",
    what: "what",
    expected: "expected",
    command: "command",
    evidence: "evidence",
    claimed: "claimed",
    hypothesis: "hypothesis_id",
    outcome: "outcome",
    execution: "execution_id",
  };
  for (const [option, field] of Object.entries(copy)) {
    const value = text(option);
    if (value !== undefined) draft[field] = value;
  }
  const files = text("files");
  if (files !== undefined) draft["files"] = files.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
  const patchFile = text("patch-file");
  if (patchFile !== undefined) draft["patch"] = readFileSync(patchFile, "utf8");

  const materials: Material[] = [];
  for (const item of asList(values["material"])) {
    const { label, value } = splitLabel(item, "material");
    materials.push({ label, content: value, nature: "illustration" });
  }
  for (const item of asList(values["material-file"])) {
    const { label, value } = splitLabel(item, "material-file");
    materials.push({ label, content: readFileSync(value, "utf8"), nature: "illustration" });
  }
  if (materials.length > 0) draft["materials"] = materials;
  return draft;
}

function asList(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function splitLabel(item: string, option: string): { label: string; value: string } {
  const at = item.indexOf("=");
  if (at <= 0) throw new TaskLogError(`--${option} expects "<label>=<value>", got "${item}"`);
  return { label: item.slice(0, at).trim(), value: item.slice(at + 1) };
}

function replay(args: string[], dataDir: string, io: CliIo): number {
  const { values } = parseArgs({ args, options: { json: { type: "boolean" }, event: { type: "string" } }, strict: true });
  const task = currentTask(dataDir);
  if (!task) {
    io.stdout(values.json ? "null\n" : `Brak otwartego zadania w ${dataDir}. Rozpocznij je przez /devguide w Claude Code.\n`);
    return 0;
  }
  const events = readEvents(task);
  if (values.event) {
    const event = events.find((item) => item.id === values.event);
    if (!event) throw new TaskLogError(`no event with id "${values.event}" in task ${task.record.id}`);
    io.stdout(values.json ? `${JSON.stringify(event, null, 2)}\n` : `${formatEvent(event)}\n`);
    return 0;
  }
  const summary = summarize(task.record, events);
  if (values.json) {
    io.stdout(`${JSON.stringify({ task: task.record, events, summary }, null, 2)}\n`);
  } else {
    io.stdout(`${formatSummary(summary)}\n\nPrzebieg:\n${formatTimeline(events)}\n`);
  }
  return 0;
}

function status(args: string[], dataDir: string, io: CliIo): number {
  const { values } = parseArgs({ args, options: { json: { type: "boolean" } }, strict: true });
  const task = currentTask(dataDir);
  if (!task) {
    io.stdout(values.json ? "null\n" : `Brak otwartego zadania w ${dataDir}.\n`);
    return 0;
  }
  const summary = summarize(task.record, readEvents(task));
  io.stdout(values.json ? `${JSON.stringify(summary, null, 2)}\n` : `${formatSummary(summary)}\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = run(process.argv.slice(2), {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    env: process.env,
    cwd: process.cwd(),
  });
}
