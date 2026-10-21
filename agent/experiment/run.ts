// Integration experiment (stages 2 and 3). Runs Claude Code twice in print
// mode with the DevGuide hooks loaded, asks it to do a fixed list of actions
// (file changes, commands, findings recorded through the CLI), then checks
// the activity log, the task log and the disk for proof that each question
// has an answer: the five of stage 2 and three about the task log of stage 3.
// Requires an installed and logged-in Claude Code; it spends tokens, so it
// is not part of `npm run check`.
//
// Usage: npm run experiment
// Environment:
//   DEVGUIDE_EXPERIMENT_MODEL  model alias passed to claude (default: sonnet)
//   DEVGUIDE_EXPERIMENT_KEEP   set to 1 to keep a previous .devguide/experiment/
// Exit code 0 only when every question is answered "tak".

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { currentTask, readEvents } from "../../process/task-log.ts";
import type { LogEntry } from "../hooks/record-event.ts";
import { allPassed, evaluate, formatReport, type ExperimentObservations } from "./evaluate.ts";

const REPO_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const EXPERIMENT_DIR = join(REPO_ROOT, ".devguide", "experiment");
const WORK_DIR = join(EXPERIMENT_DIR, "work");
const LOG_FILE = join(EXPERIMENT_DIR, "events.jsonl");
const REPORT_FILE = join(EXPERIMENT_DIR, "report.txt");
const SETTINGS_FILE = join("agent", "experiment", "settings.json");
const HELLO_FILE = "hello.txt";
const BLOCKED_FILE = "blocked.txt";

interface ClaudeRun {
  exitCode: number | null;
  result: string;
  sessionId: string | null;
  costUsd: number | null;
  durationMs: number | null;
  permissionDenials: unknown;
  stderr: string;
  raw: string;
}

function claudeVersion(): string | null {
  const run = spawnSync("claude", ["--version"], { encoding: "utf8" });
  if (run.error || run.status !== 0) return null;
  return run.stdout.trim();
}

function runClaude(prompt: string, args: string[], label: string): ClaudeRun {
  const started = Date.now();
  const run = spawnSync("claude", ["-p", "--output-format", "json", "--settings", SETTINGS_FILE, ...args], {
    cwd: REPO_ROOT,
    input: prompt,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
    env: { ...process.env, DEVGUIDE_DIR: EXPERIMENT_DIR },
  });
  if (run.error) {
    throw new Error(`${label}: could not start claude: ${run.error.message}`);
  }
  writeFileSync(join(EXPERIMENT_DIR, `${label}.json`), run.stdout, "utf8");
  if (run.stderr.length > 0) writeFileSync(join(EXPERIMENT_DIR, `${label}.stderr.txt`), run.stderr, "utf8");
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(run.stdout) as Record<string, unknown>;
  } catch {
    // Leave parsed empty; the raw output is kept in the file above.
  }
  return {
    exitCode: run.status,
    result: typeof parsed["result"] === "string" ? parsed["result"] : "",
    sessionId: typeof parsed["session_id"] === "string" ? parsed["session_id"] : null,
    costUsd: typeof parsed["total_cost_usd"] === "number" ? parsed["total_cost_usd"] : null,
    durationMs: typeof parsed["duration_ms"] === "number" ? parsed["duration_ms"] : Date.now() - started,
    permissionDenials: parsed["permission_denials"],
    stderr: run.stderr,
    raw: run.stdout,
  };
}

function readLog(): LogEntry[] {
  if (!existsSync(LOG_FILE)) return [];
  return readFileSync(LOG_FILE, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as LogEntry);
}

function taskPrompt(codeWord: string): string {
  const hello = join(WORK_DIR, HELLO_FILE);
  const blocked = join(WORK_DIR, BLOCKED_FILE);
  return [
    `/devguide Integration experiment, code word ${codeWord}. Do these steps in order, one tool call each, and do not skip any:`,
    `1. Use the Write tool to create the file ${hello} with exactly this content: hello from devguide`,
    `2. Use the Edit tool to change the word "hello" to "greetings" in ${hello}.`,
    `3. Use the Bash tool to run exactly: echo devguide-ok`,
    `4. Use the Bash tool to run exactly: echo devguide-block-me > "${blocked}"`,
    `   If this step is refused, do not retry it and do not create that file in any other way.`,
    `5. Use the Bash tool to run exactly: node process/cli.ts record observation --text "hello.txt now says greetings" --files "${HELLO_FILE}" --material "sample=greetings from devguide"`,
    `6. Use the Bash tool to run exactly: node process/cli.ts record hypothesis --text "the hooks record every step of this experiment"`,
    `7. Use the Bash tool to run exactly: node process/cli.ts record check --what "echo printed the marker" --expected "devguide-ok" --command "echo devguide-ok" --evidence "devguide-ok" --claimed passed`,
    `8. Remember the code word ${codeWord}; you will be asked for it in a later session.`,
    `Finally report, one line per step, what happened, including any refusal.`,
  ].join("\n");
}

const RESUME_PROMPT = [
  "Answer with exactly two lines and nothing else.",
  "Line 1: the code word I gave you in this session.",
  "Line 2: the id of the open DevGuide task, if you know it; otherwise the word unknown.",
].join("\n");

export async function main(): Promise<number> {
  const version = claudeVersion();
  if (version === null) {
    process.stderr.write(
      "experiment: Claude Code is not available. Install it and log in, then make sure `claude --version` works in this shell.\n",
    );
    return 2;
  }

  if (process.env["DEVGUIDE_EXPERIMENT_KEEP"] !== "1") {
    rmSync(EXPERIMENT_DIR, { recursive: true, force: true });
  }
  mkdirSync(WORK_DIR, { recursive: true });
  writeFileSync(LOG_FILE, "", "utf8");

  const model = process.env["DEVGUIDE_EXPERIMENT_MODEL"] ?? "sonnet";
  const sessionId = randomUUID();
  const codeWord = `tulip-${randomUUID().slice(0, 8)}`;
  const header = [
    `DevGuide - eksperyment integracji (etapy 2 i 3)`,
    `Data: ${new Date().toISOString()}`,
    `Claude Code: ${version}`,
    `System: ${process.platform} ${process.arch}, Node ${process.version}`,
    `Model: ${model}`,
    `Sesja: ${sessionId}`,
  ];

  process.stdout.write(`${header.join("\n")}\n\nSesja 1 (zadanie przez /devguide)...\n`);
  const first = runClaude(
    taskPrompt(codeWord),
    [
      "--session-id", sessionId,
      "--model", model,
      "--permission-mode", "acceptEdits",
      "--permission-prompts", "none",
      "--allowedTools", "Write,Edit,Read,Bash(echo *),Bash(node process/cli.ts *)",
      "--max-turns", "15",
      "--max-budget-usd", "3",
    ],
    "session-1",
  );
  process.stdout.write(`  exit ${first.exitCode}, session ${first.sessionId}, ${first.durationMs} ms, koszt ${first.costUsd ?? "?"} USD\n`);

  process.stdout.write(`Sesja 2 (wznowienie przez --resume)...\n`);
  const second = runClaude(
    RESUME_PROMPT,
    ["--resume", sessionId, "--model", model, "--max-turns", "3", "--max-budget-usd", "1"],
    "session-2",
  );
  process.stdout.write(`  exit ${second.exitCode}, session ${second.sessionId}, ${second.durationMs} ms, koszt ${second.costUsd ?? "?"} USD\n`);

  const helloPath = join(WORK_DIR, HELLO_FILE);
  const task = currentTask(EXPERIMENT_DIR);
  const observations: ExperimentObservations = {
    sessionId,
    codeWord,
    helloFile: HELLO_FILE,
    blockedFile: BLOCKED_FILE,
    helloExists: existsSync(helloPath),
    helloContent: existsSync(helloPath) ? readFileSync(helloPath, "utf8") : null,
    blockedExists: existsSync(join(WORK_DIR, BLOCKED_FILE)),
    firstAnswer: first.result,
    secondAnswer: second.result,
    entries: readLog(),
    taskId: task?.record.id ?? null,
    taskEvents: task ? readEvents(task) : [],
  };
  const findings = evaluate(observations);

  header.push(
    `Koszt: sesja 1 ${first.costUsd ?? "?"} USD, sesja 2 ${second.costUsd ?? "?"} USD`,
    `Czas: sesja 1 ${first.durationMs} ms, sesja 2 ${second.durationMs} ms (etap 2 bez dziennika zadania: 9275 ms i 1428 ms)`,
    `Wpisy w surowym dzienniku: ${observations.entries.length}`,
    `Zadanie: ${observations.taskId ?? "brak"}, zdarzeń w zadaniu: ${observations.taskEvents.length}`,
    `permission_denials sesji 1: ${JSON.stringify(first.permissionDenials ?? null).slice(0, 300)}`,
    `Odpowiedź sesji 1:`,
    ...first.result.split("\n").map((line) => `  | ${line}`),
    `Odpowiedź sesji 2: ${JSON.stringify(second.result)}`,
  );
  const report = formatReport(findings, header);
  writeFileSync(REPORT_FILE, `${report}\n`, "utf8");
  const taskLog = task ? join(EXPERIMENT_DIR, "tasks", task.record.id, "events.jsonl") : "(brak zadania)";
  process.stdout.write(`\n${report}\n\nRaport: ${REPORT_FILE}\nSurowy dziennik: ${LOG_FILE}\nDziennik zadania: ${taskLog}\n`);
  return allPassed(findings) ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
