// Reading the task log back: a summary of where the task stands (hypotheses,
// checks, decisions), a timeline in plain Polish for the user, the full
// fields of one event on request, and a short context for the agent at the
// start of a session. Pure functions over the list of events; the preview of
// stage 4 is meant to reuse them.

import { sameCodeVersion } from "./code-version.ts";
import type { CheckReason, CheckStatus, CodeVersion, Origin, TaskEvent } from "./events.ts";
import type { TaskRecord } from "./task-log.ts";

export interface HypothesisState {
  id: string;
  text: string;
  status: "open" | "confirmed" | "rejected";
  resolution: { id: string; text: string } | null;
}

export interface CheckState {
  id: string;
  what: string;
  command: string;
  claimed: string;
  status: CheckStatus;
  reason: CheckReason | null;
  execution_id: string | null;
  /** True when no later event in the task has a different code version than the execution. */
  current: boolean;
}

export interface DecisionState {
  id: string;
  question: string;
  quote: string;
  reading: string;
  confirmed: boolean;
}

export interface TaskSummary {
  task: TaskRecord;
  counts: { events: number; by_origin: Record<Origin, number> };
  hypotheses: HypothesisState[];
  checks: CheckState[];
  decisions: DecisionState[];
  files: string[];
  latest_code_version: CodeVersion | null;
}

export function summarize(task: TaskRecord, events: TaskEvent[]): TaskSummary {
  const byOrigin: Record<Origin, number> = { user: 0, tool: 0, agent: 0, devguide: 0 };
  for (const event of events) byOrigin[event.origin] += 1;

  const latest = events.findLast((event) => event.code_version.commit !== null)?.code_version ?? null;

  const hypotheses: HypothesisState[] = [];
  for (const event of events) {
    if (event.kind === "hypothesis") {
      hypotheses.push({ id: event.id, text: event.text, status: "open", resolution: null });
    } else if (event.kind === "hypothesis_resolved") {
      const target = hypotheses.find((item) => item.id === event.hypothesis_id);
      if (target) {
        target.status = event.outcome;
        target.resolution = { id: event.id, text: event.text };
      }
    }
  }

  const checks: CheckState[] = events
    .filter((event) => event.kind === "check")
    .map((event) => {
      const execution = event.execution_id ? events.find((item) => item.id === event.execution_id) : undefined;
      return {
        id: event.id,
        what: event.what,
        command: event.command,
        claimed: event.claimed,
        status: event.status,
        reason: event.reason,
        execution_id: event.execution_id,
        current: execution !== undefined && sameCodeVersion(execution.code_version, latest),
      };
    });

  const decisions: DecisionState[] = events
    .filter((event) => event.kind === "decision")
    .map((event) => ({ id: event.id, question: event.question, quote: event.quote, reading: event.reading, confirmed: event.confirmed }));

  const files = [...new Set(events.flatMap((event) => event.files))].sort();

  return { task, counts: { events: events.length, by_origin: byOrigin }, hypotheses, checks, decisions, files, latest_code_version: latest };
}

// --- text for people ---------------------------------------------------------

const ORIGIN_LABEL: Record<Origin, string> = {
  user: "użytkownik",
  tool: "narzędzie",
  agent: "AI",
  devguide: "DevGuide",
};

const CHECK_STATUS_LABEL: Record<CheckStatus, string> = {
  passed: "przeszło",
  failed: "nie przeszło",
  inconclusive: "nierozstrzygnięte",
  unverified: "niepotwierdzone",
};

const CHECK_REASON_LABEL: Record<CheckReason, string> = {
  no_execution: "brak zarejestrowanego wykonania polecenia",
  evidence_not_found: "dowodu nie ma w wyjściu polecenia",
  no_evidence: "nie podano dowodu z wyjścia polecenia",
};

const HYPOTHESIS_STATUS_LABEL: Record<HypothesisState["status"], string> = {
  open: "otwarta",
  confirmed: "potwierdzona",
  rejected: "odrzucona",
};

function clip(text: string, max = 120): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

function clock(time: string): string {
  return time.slice(11, 19);
}

/** One sentence per event, in plain language. */
export function describeEvent(event: TaskEvent): string {
  switch (event.kind) {
    case "task_started":
      return `Rozpoczęto zadanie: ${clip(event.description)}`;
    case "user_prompt":
      return `Użytkownik napisał: „${clip(event.text)}”`;
    case "session_resumed":
      return event.source === "resume" ? "Wznowiono sesję" : `Nowa sesja przy otwartym zadaniu (${event.source})`;
    case "observation":
      return `Obserwacja: ${clip(event.text)}${materialsNote(event.materials.length)}`;
    case "hypothesis":
      return `Hipoteza: ${clip(event.text)}`;
    case "hypothesis_resolved":
      return `Hipoteza ${event.hypothesis_id} ${event.outcome === "confirmed" ? "potwierdzona" : "odrzucona"}: ${clip(event.text)}`;
    case "proposal":
      return `Propozycja: ${clip(event.text)}${materialsNote(event.materials.length)}`;
    case "change_prepared":
      return `Przygotowano zmianę: ${clip(event.text)}${event.files.length > 0 ? ` (pliki: ${event.files.join(", ")})` : ""}`;
    case "file_changed":
      return `${event.created ? "Utworzono plik" : "Zmieniono plik"} ${event.path}`;
    case "command_run":
      return `Uruchomiono polecenie: ${clip(event.command, 100)} (wyjście: ${event.stdout.length} znaków${event.stderr.length > 0 ? `, błędy: ${event.stderr.length} znaków` : ""}${event.interrupted ? ", przerwane" : ""}, kod wyjścia nieznany)`;
    case "tool_failed":
      return `Narzędzie ${event.tool} zgłosiło błąd`;
    case "decision":
      return `Decyzja użytkownika (${event.confirmed ? "potwierdzona cytatem" : "niepotwierdzona"}): ${clip(event.reading)}`;
    case "check":
      return `Sprawdzenie: ${clip(event.what)} — ${CHECK_STATUS_LABEL[event.status]}${event.reason ? ` (${CHECK_REASON_LABEL[event.reason]})` : ""}`;
    case "agent_message":
      return `AI napisało: „${clip(event.text)}”`;
  }
}

function materialsNote(count: number): string {
  return count > 0 ? ` [ilustracje od AI: ${count}]` : "";
}

export function formatTimeline(events: TaskEvent[]): string {
  if (events.length === 0) return "Zadanie nie ma jeszcze zdarzeń.";
  return events.map((event) => `${clock(event.time)} [${ORIGIN_LABEL[event.origin]}] ${describeEvent(event)} (${event.id})`).join("\n");
}

export function formatSummary(summary: TaskSummary): string {
  const lines: string[] = [];
  lines.push(`Zadanie ${summary.task.id}: ${clip(summary.task.description, 160)}`);
  lines.push(`Rozpoczęte ${summary.task.started}, zdarzeń: ${summary.counts.events} (użytkownik ${summary.counts.by_origin.user}, narzędzia ${summary.counts.by_origin.tool}, AI ${summary.counts.by_origin.agent}, DevGuide ${summary.counts.by_origin.devguide})`);
  if (summary.latest_code_version) {
    lines.push(`Bieżąca wersja kodu: commit ${summary.latest_code_version.commit?.slice(0, 12) ?? "nieznany"}, drzewo ${summary.latest_code_version.working_tree?.slice(0, 12) ?? "nieznane"}`);
  } else {
    lines.push("Bieżąca wersja kodu: nieznana");
  }

  lines.push("", `Hipotezy (${summary.hypotheses.length}):`);
  if (summary.hypotheses.length === 0) lines.push("  brak");
  for (const hypothesis of summary.hypotheses) {
    lines.push(`  - [${HYPOTHESIS_STATUS_LABEL[hypothesis.status]}] ${clip(hypothesis.text)} (${hypothesis.id})`);
    if (hypothesis.resolution) lines.push(`      powód: ${clip(hypothesis.resolution.text)}`);
  }

  lines.push("", `Sprawdzenia (${summary.checks.length}):`);
  if (summary.checks.length === 0) lines.push("  brak");
  for (const check of summary.checks) {
    let status = CHECK_STATUS_LABEL[check.status];
    if (check.status !== "unverified" && !check.current) status += " na wcześniejszej wersji kodu";
    lines.push(`  - [${status}] ${clip(check.what)} (${check.id})`);
    if (check.reason) lines.push(`      powód: ${CHECK_REASON_LABEL[check.reason]}`);
  }

  const unconfirmed = summary.decisions.filter((decision) => !decision.confirmed);
  lines.push("", `Decyzje użytkownika: ${summary.decisions.length}, w tym niepotwierdzone cytatem: ${unconfirmed.length}`);
  for (const decision of unconfirmed) lines.push(`  - [niepotwierdzona] ${clip(decision.reading)} (${decision.id})`);

  if (summary.files.length > 0) lines.push("", `Pliki: ${summary.files.join(", ")}`);
  return lines.join("\n");
}

/** Every field of one event, for the details view. */
export function formatEvent(event: TaskEvent): string {
  const lines = [`${describeEvent(event)}`, ""];
  for (const [key, value] of Object.entries(event)) {
    const rendered = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    if (rendered.includes("\n")) {
      lines.push(`${key}:`, ...rendered.split("\n").map((line) => `  ${line}`));
    } else {
      lines.push(`${key}: ${rendered}`);
    }
  }
  return lines.join("\n");
}

/** Short context for the agent at the start of a session with an open task (English: the reader is the agent). */
export function sessionContext(summary: TaskSummary): string {
  const open = summary.hypotheses.filter((item) => item.status === "open").length;
  const passed = summary.checks.filter((item) => item.status === "passed" && item.current).length;
  const unverified = summary.checks.filter((item) => item.status === "unverified").length;
  return [
    `DevGuide task ${summary.task.id} is open: ${summary.task.description}`,
    `Recorded so far: ${summary.counts.events} events; hypotheses ${summary.hypotheses.length} (${open} open); checks ${summary.checks.length} (${passed} passed on the current code, ${unverified} unverified); decisions ${summary.decisions.length}.`,
    "Run `node process/cli.ts replay` for the full course and `node process/cli.ts status` for the summary before continuing.",
  ].join("\n");
}
