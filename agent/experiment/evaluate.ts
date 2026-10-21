// Pure evaluation of the stage 2 integration experiment. Takes the activity
// log, what is on disk and what the two Claude Code sessions answered, and
// turns them into one verdict per question from the plan. No I/O here, so
// the rules can be tested without Claude Code.

import type { TaskEvent } from "../../process/events.ts";
import { CLI_RECORD_MARKER } from "../../process/task-log.ts";
import { BLOCK_MARKER } from "../hooks/record-event.ts";
import type { LogEntry } from "../hooks/record-event.ts";

export type Verdict = "tak" | "nie" | "nierozstrzygnięte";

export interface Finding {
  /** Question from stage 2 of the plan, in the user's words. */
  question: string;
  verdict: Verdict;
  /** Concrete evidence: log entries, files, quoted answers. */
  evidence: string[];
  /** Observations that do not change the verdict but belong in the findings document. */
  notes: string[];
}

export interface ExperimentObservations {
  sessionId: string;
  codeWord: string;
  /** Name of the file the agent was asked to create, relative to the work directory. */
  helloFile: string;
  /** Name of the file the blocked command would have created. */
  blockedFile: string;
  helloExists: boolean;
  helloContent: string | null;
  blockedExists: boolean;
  /** `result` field of session 1 (the task run). */
  firstAnswer: string;
  /** `result` field of session 2 (the resumed run). */
  secondAnswer: string;
  entries: LogEntry[];
  /** Id of the DevGuide task opened by session 1, from the data directory; null when none. */
  taskId: string | null;
  /** Events of that task. */
  taskEvents: TaskEvent[];
}

export const CONFIRMATION_LINE = "DevGuide mode is active.";

const REFUSAL_WORDS = /block|denied|refus|odm[oó]w|zablokow|not (?:run|executed|allowed)|nie (?:został|zostało|było) (?:wykonan|uruchomion)/i;

export function evaluate(observations: ExperimentObservations): Finding[] {
  const own = observations.entries.filter((entry) => entry.session_id === observations.sessionId);
  return [
    evaluateSkill(observations, own),
    evaluateActivity(observations, own),
    evaluateRecording(observations, own),
    evaluateBlock(observations, own),
    evaluateResume(observations, own),
    evaluateTaskFindings(observations),
    evaluateTaskToolEvents(observations),
    evaluateTaskContext(observations),
  ];
}

export function allPassed(findings: Finding[]): boolean {
  return findings.every((finding) => finding.verdict === "tak");
}

function evaluateSkill(observations: ExperimentObservations, entries: LogEntry[]): Finding {
  const evidence: string[] = [];
  const notes: string[] = [];
  const confirmed = observations.firstAnswer.includes(CONFIRMATION_LINE);
  evidence.push(
    confirmed
      ? `odpowiedź sesji 1 zawiera "${CONFIRMATION_LINE}"`
      : `odpowiedź sesji 1 nie zawiera "${CONFIRMATION_LINE}"`,
  );
  const start = entries.find((entry) => entry.event === "UserPromptSubmit" && entry.kind === "task_started");
  if (start) {
    const prompt = String(start.payload["prompt"] ?? "");
    evidence.push(`wpis UserPromptSubmit kind=task_started o ${start.time}, prompt zaczyna się od ${JSON.stringify(prompt.slice(0, 40))}`);
    if (!prompt.includes(observations.codeWord)) {
      notes.push("prompt w dzienniku nie zawiera treści zadania; hook widział inny tekst niż przekazany");
    }
  } else {
    evidence.push("brak wpisu UserPromptSubmit oznaczonego jako start zadania");
  }
  const promptEntries = entries.filter((entry) => entry.event === "UserPromptSubmit");
  if (!start && promptEntries.length > 0) {
    notes.push(`UserPromptSubmit widział: ${JSON.stringify(String(promptEntries[0]!.payload["prompt"] ?? "").slice(0, 80))}`);
  }
  return {
    question: "Jak uruchomić skill prowadzący",
    verdict: confirmed && start !== undefined && start.payload["prompt"] !== undefined && String(start.payload["prompt"]).includes(observations.codeWord) ? "tak" : "nie",
    evidence,
    notes,
  };
}

function evaluateActivity(_observations: ExperimentObservations, entries: LogEntry[]): Finding {
  const evidence: string[] = [];
  const missing: string[] = [];
  const startup = entries.find((entry) => entry.event === "SessionStart" && entry.payload["source"] === "startup");
  if (startup) evidence.push(`SessionStart source=startup o ${startup.time}`);
  else missing.push("SessionStart source=startup");
  for (const tool of ["Write", "Edit", "Bash"]) {
    for (const event of ["PreToolUse", "PostToolUse"]) {
      const found = entries.find((entry) => entry.event === event && entry.payload["tool_name"] === tool);
      if (found) evidence.push(`${event} ${tool} o ${found.time}`);
      else missing.push(`${event} ${tool}`);
    }
  }
  const stop = entries.find(
    (entry) => entry.event === "Stop" && entry.source === "agent" && String(entry.payload["last_assistant_message"] ?? "").length > 0,
  );
  if (stop) evidence.push(`Stop source=agent z last_assistant_message o ${stop.time}`);
  else missing.push("Stop z tekstem agenta");
  if (missing.length > 0) evidence.push(`brakuje: ${missing.join(", ")}`);
  return {
    question: "Jak odbierać informacje o wykonanych działaniach",
    verdict: missing.length === 0 ? "tak" : "nie",
    evidence,
    notes: [],
  };
}

function evaluateRecording(observations: ExperimentObservations, entries: LogEntry[]): Finding {
  const evidence: string[] = [];
  const notes: string[] = [];
  let ok = true;

  const write = entries.find((entry) => entry.event === "PostToolUse" && entry.payload["tool_name"] === "Write");
  if (write && JSON.stringify(write.payload).includes(observations.helloFile)) {
    evidence.push(`PostToolUse Write wskazuje ${observations.helloFile}`);
  } else {
    ok = false;
    evidence.push(`brak wpisu PostToolUse Write z ${observations.helloFile}`);
  }
  if (observations.helloExists) {
    evidence.push(`plik ${observations.helloFile} istnieje, treść: ${JSON.stringify(observations.helloContent)}`);
  } else {
    ok = false;
    evidence.push(`plik ${observations.helloFile} nie istnieje`);
  }

  const edit = entries.find((entry) => entry.event === "PostToolUse" && entry.payload["tool_name"] === "Edit");
  if (edit) {
    notes.push(`tool_response dla Edit: ${JSON.stringify(edit.payload["tool_response"]).slice(0, 400)}`);
  } else {
    notes.push("brak PostToolUse dla Edit, kształt tool_response nieznany");
  }

  const bash = entries.find(
    (entry) =>
      entry.event === "PostToolUse" &&
      entry.payload["tool_name"] === "Bash" &&
      JSON.stringify(entry.payload["tool_response"] ?? "").includes("devguide-ok"),
  );
  if (bash) {
    evidence.push(`PostToolUse Bash zawiera "devguide-ok" w tool_response`);
    notes.push(`tool_response dla Bash: ${JSON.stringify(bash.payload["tool_response"]).slice(0, 400)}`);
  } else {
    ok = false;
    evidence.push(`brak wpisu PostToolUse Bash z "devguide-ok" w wyniku`);
  }
  const failures = entries.filter((entry) => entry.event === "PostToolUseFailure");
  if (failures.length > 0) notes.push(`PostToolUseFailure: ${failures.length} wpis(y)`);
  return {
    question: "Jak rejestrować zmiany plików i wyniki poleceń",
    verdict: ok ? "tak" : "nie",
    evidence,
    notes,
  };
}

function evaluateBlock(observations: ExperimentObservations, entries: LogEntry[]): Finding {
  const evidence: string[] = [];
  const notes: string[] = [];
  const blocked = entries.filter((entry) => entry.event === "PreToolUse" && entry.kind === "blocked");
  const attempted = entries.filter(
    (entry) => entry.event === "PreToolUse" && JSON.stringify(entry.payload["tool_input"] ?? "").includes(BLOCK_MARKER),
  );
  const ran = entries.filter(
    (entry) => entry.event === "PostToolUse" && JSON.stringify(entry.payload["tool_input"] ?? "").includes(BLOCK_MARKER),
  );

  evidence.push(observations.blockedExists ? `plik ${observations.blockedFile} ISTNIEJE` : `plik ${observations.blockedFile} nie istnieje`);
  if (blocked.length > 0) {
    const command = String((blocked[0]!.payload["tool_input"] as { command?: string } | undefined)?.command ?? "");
    evidence.push(`${blocked.length} wpis(y) PreToolUse kind=blocked, pierwszy o ${blocked[0]!.time}, polecenie ${JSON.stringify(command)}`);
  } else {
    evidence.push("brak wpisu odmowy w dzienniku");
  }
  if (ran.length > 0) evidence.push(`UWAGA: ${ran.length} wpis(y) PostToolUse dla polecenia ze znacznikiem, czyli polecenie wykonało się`);
  if (attempted.length === 0) notes.push("agent nie próbował uruchomić blokowanego polecenia (brak PreToolUse ze znacznikiem)");

  let verdict: Verdict;
  if (observations.blockedExists || ran.length > 0) verdict = "nie";
  else if (blocked.length > 0) verdict = "tak";
  else verdict = "nierozstrzygnięte";

  if (verdict === "tak" && !REFUSAL_WORDS.test(observations.firstAnswer)) {
    notes.push("rozbieżność: odpowiedź agenta nie wspomina o odmowie; status opiera się na dysku i dzienniku, nie na wypowiedzi");
  }
  return {
    question: "Czy i jak można zatrzymać określoną operację przed wykonaniem",
    verdict,
    evidence,
    notes,
  };
}

function evaluateResume(observations: ExperimentObservations, entries: LogEntry[]): Finding {
  const evidence: string[] = [];
  const resumed = entries.find((entry) => entry.event === "SessionStart" && entry.payload["source"] === "resume");
  if (resumed) evidence.push(`SessionStart source=resume o ${resumed.time} z session_id ${resumed.session_id}`);
  else evidence.push("brak SessionStart source=resume dla tej sesji");
  const remembered = observations.secondAnswer.toLowerCase().includes(observations.codeWord.toLowerCase());
  evidence.push(
    remembered
      ? `odpowiedź sesji 2 zawiera słowo-klucz: ${JSON.stringify(observations.secondAnswer.slice(0, 80))}`
      : `odpowiedź sesji 2 nie zawiera słowa-klucza: ${JSON.stringify(observations.secondAnswer.slice(0, 80))}`,
  );
  return {
    question: "Jak wznowić zadanie po przerwaniu sesji",
    verdict: resumed !== undefined && remembered ? "tak" : "nie",
    evidence,
    notes: [],
  };
}

// --- stage 3: the task log -----------------------------------------------------

function evaluateTaskFindings(observations: ExperimentObservations): Finding {
  const evidence: string[] = [];
  const notes: string[] = [];
  const events = observations.taskEvents;
  let ok = observations.taskId !== null;
  if (observations.taskId === null) evidence.push("brak otwartego zadania w katalogu danych");

  const observation = events.find((event) => event.kind === "observation");
  if (observation && observation.kind === "observation") {
    const illustrations = observation.materials.filter((item) => item.nature === "illustration").length;
    evidence.push(`observation ${observation.id} o ${observation.time}, materiały: ${observation.materials.length} (ilustracje: ${illustrations})`);
    if (observation.materials.length === 0 || illustrations !== observation.materials.length) {
      ok = false;
      evidence.push("obserwacja bez materiału oznaczonego jako ilustracja");
    }
  } else {
    ok = false;
    evidence.push("brak zdarzenia observation w zadaniu");
  }

  const hypothesis = events.find((event) => event.kind === "hypothesis");
  if (hypothesis) evidence.push(`hypothesis ${hypothesis.id} o ${hypothesis.time}`);
  else {
    ok = false;
    evidence.push("brak zdarzenia hypothesis w zadaniu");
  }

  const check = events.find((event) => event.kind === "check");
  if (check && check.kind === "check") {
    const execution = events.find((event) => event.id === check.execution_id);
    evidence.push(`check ${check.id}: claimed=${check.claimed}, status=${check.status}, execution_id=${check.execution_id ?? "null"}${check.reason ? `, reason=${check.reason}` : ""}`);
    if (check.status !== "passed") {
      ok = false;
      evidence.push("sprawdzenie nie ma statusu passed");
    }
    if (!execution || execution.kind !== "command_run" || !execution.stdout.includes("devguide-ok")) {
      ok = false;
      evidence.push("execution_id nie wskazuje command_run z devguide-ok w stdout");
    } else {
      evidence.push(`wykonanie ${execution.id}: ${JSON.stringify(execution.command)} ze stdout ${JSON.stringify(execution.stdout.trim())}`);
    }
  } else {
    ok = false;
    evidence.push("brak zdarzenia check w zadaniu");
  }

  const agentEvents = events.filter((event) => event.origin === "agent" && event.kind !== "agent_message");
  notes.push(`zdarzeń pochodzenia agent (bez komunikatów): ${agentEvents.length}`);
  return {
    question: "Czy ustalenia agenta trafiają do dziennika zadania",
    verdict: ok ? "tak" : "nie",
    evidence,
    notes,
  };
}

function evaluateTaskToolEvents(observations: ExperimentObservations): Finding {
  const evidence: string[] = [];
  const notes: string[] = [];
  const events = observations.taskEvents;
  let ok = true;

  const started = events.find((event) => event.kind === "task_started");
  if (started && started.kind === "task_started" && started.description.includes(observations.codeWord)) {
    evidence.push(`task_started ${started.id} z opisem zadania`);
  } else {
    ok = false;
    evidence.push("brak task_started z treścią zadania");
  }

  const edited = events.find(
    (event) => event.kind === "file_changed" && event.tool === "Edit" && event.path.endsWith(observations.helloFile),
  );
  if (edited && edited.kind === "file_changed" && edited.before !== null && edited.after !== null) {
    evidence.push(`file_changed ${edited.id} (Edit) dla ${edited.path}: before=${JSON.stringify(edited.before)}, after=${JSON.stringify(edited.after)}`);
  } else {
    ok = false;
    evidence.push(`brak file_changed z Edit dla ${observations.helloFile} z before i after`);
  }
  const created = events.find((event) => event.kind === "file_changed" && event.created && event.path.endsWith(observations.helloFile));
  if (created) evidence.push(`file_changed ${created.id} (utworzenie) dla ${observations.helloFile}`);

  const run = events.find((event) => event.kind === "command_run" && event.stdout.includes("devguide-ok"));
  if (run && run.kind === "command_run") {
    evidence.push(`command_run ${run.id}: ${JSON.stringify(run.command)}, exit_code=${run.exit_code}`);
  } else {
    ok = false;
    evidence.push("brak command_run z devguide-ok");
  }

  const cliRuns = events.filter((event) => event.kind === "command_run" && event.command.includes(CLI_RECORD_MARKER));
  if (cliRuns.length > 0) {
    ok = false;
    evidence.push(`UWAGA: ${cliRuns.length} command_run dla wywołań CLI zapisu, które miały być pominięte`);
  } else {
    evidence.push("brak command_run dla wywołań CLI zapisu");
  }

  const versions = new Set(events.map((event) => `${event.code_version.commit}/${event.code_version.working_tree}`));
  notes.push(`różnych wersji kodu w zadaniu: ${versions.size}; zdarzeń w zadaniu: ${events.length}`);
  const failures = events.filter((event) => event.kind === "tool_failed");
  if (failures.length > 0) notes.push(`tool_failed: ${failures.length}, pierwszy: ${JSON.stringify(failures[0]).slice(0, 300)}`);
  return {
    question: "Czy zdarzenia narzędzi trafiają do dziennika zadania",
    verdict: ok ? "tak" : "nie",
    evidence,
    notes,
  };
}

function evaluateTaskContext(observations: ExperimentObservations): Finding {
  const evidence: string[] = [];
  const resumed = observations.taskEvents.find((event) => event.kind === "session_resumed" && event.source === "resume");
  if (resumed) evidence.push(`session_resumed ${resumed.id} o ${resumed.time}`);
  else evidence.push("brak zdarzenia session_resumed w zadaniu");
  const knows = observations.taskId !== null && observations.secondAnswer.includes(observations.taskId);
  evidence.push(
    knows
      ? `odpowiedź sesji 2 zawiera identyfikator zadania ${observations.taskId}`
      : `odpowiedź sesji 2 nie zawiera identyfikatora zadania ${observations.taskId ?? "(brak)"}: ${JSON.stringify(observations.secondAnswer.slice(0, 120))}`,
  );
  return {
    question: "Czy agent dostaje kontekst zadania po wznowieniu sesji",
    verdict: resumed !== undefined && knows ? "tak" : "nie",
    evidence,
    notes: ["identyfikator zadania zna tylko hook; CLI wypisuje identyfikatory zdarzeń, więc agent może go znać wyłącznie z additionalContext"],
  };
}

export function formatReport(findings: Finding[], header: string[]): string {
  const lines: string[] = [...header, ""];
  for (const finding of findings) {
    lines.push(`${finding.verdict.toUpperCase().padEnd(17)} ${finding.question}`);
    for (const item of finding.evidence) lines.push(`    dowód: ${item}`);
    for (const note of finding.notes) lines.push(`    uwaga: ${note}`);
  }
  lines.push("");
  lines.push(
    allPassed(findings)
      ? `Wynik: wszystkie pytania (${findings.length}) potwierdzone.`
      : "Wynik: co najmniej jedno pytanie bez potwierdzenia.",
  );
  return lines.join("\n");
}
