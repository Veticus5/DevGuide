// The view model of the local preview: what the views show, derived from the
// task's events by pure functions. The page renders this; it never interprets
// the event file itself. Every piece keeps its origin: snippets, patches and
// outputs come from `tool` events, explanations and examples from `agent`
// events, and the model never mixes the two in one field.
//
// The main view (design D11) is a history of meaningful steps with one view
// per step. Commands, tool failures, agent messages and user prompts are not
// steps: they are the sources of the step they led to.

import { sameCodeVersion } from "./code-version.ts";
import type {
  ChangeExplainedEvent,
  ChangePreparedEvent,
  CheckEvent,
  CheckReason,
  CheckStatus,
  CodeVersion,
  CommandRunEvent,
  FileChangedEvent,
  Material,
  Origin,
  TaskEvent,
} from "./events.ts";
import { describeEvent, summarize, type TaskSummary } from "./replay.ts";
import type { TaskRecord } from "./task-log.ts";

export interface TimelineItem {
  id: string;
  time: string;
  origin: Origin;
  kind: TaskEvent["kind"];
  /** One plain sentence, from `describeEvent`. */
  sentence: string;
  /** Other events this one points at, for links in the details. */
  refs: { hypothesis_id?: string; execution_id?: string; change_ids?: string[]; prompt_event_id?: string };
}

/** One recorded file change as a card shows it: tool data only. */
export interface CardChange {
  event_id: string;
  time: string;
  path: string;
  created: boolean;
  tool: string;
  before: string | null;
  after: string | null;
  /** Line range of the change in the file after it, from the first patch hunk; null when the tool gave no hunks. */
  lines: { start: number; end: number } | null;
  code_version: CodeVersion;
}

/** One logical fix: the agent's explanation plus the tool-recorded changes it covers. */
export interface CodeCard {
  id: string;
  time: string;
  title: string;
  purpose: string;
  mechanism: string;
  assumptions: string;
  materials: Material[];
  files: string[];
  changes: CardChange[];
  /** True when no recorded file change matched the explanation. */
  unmatched: boolean;
}

export interface ProposalItem {
  id: string;
  time: string;
  text: string;
  patch: string | null;
  materials: Material[];
  files: string[];
}

export interface FileDiff {
  path: string;
  /** Unified diff text built from the recorded hunks, in order of recording. */
  text: string;
  /** True when at least one change had no hunks and the diff shows before/after blocks instead. */
  partial: boolean;
}

export interface CheckItem {
  id: string;
  time: string;
  what: string;
  expected: string;
  command: string;
  evidence: string;
  claimed: string;
  status: CheckStatus;
  reason: CheckReason | null;
  limits: string | null;
  execution_id: string | null;
  /** The code version of the execution the check refers to; null without one. */
  code_version: CodeVersion | null;
  /** True when no later event has a different code version than the execution. */
  current: boolean;
  /** Paths changed by tools after the execution; empty when current. */
  changed_since: string[];
}

export interface CheckCounts {
  current_passed: number;
  stale_passed: number;
  failed: number;
  inconclusive: number;
  unverified: number;
}

// --- steps (design D11) ------------------------------------------------------

export type StepKind =
  | "task"
  | "observation"
  | "hypothesis"
  | "resolution"
  | "proposal"
  | "prepared"
  | "change"
  | "unexplained_change"
  | "check"
  | "decision"
  | "tool_run";

export interface Excerpt {
  excerpt: string;
  truncated: boolean;
}

export interface ExampleMaterial extends Excerpt {
  label: string;
  /** `tool` only for outputs a tool returned; everything the agent attached is an illustration. */
  nature: "tool" | "illustration";
}

export type StepBlock =
  | { kind: "note"; text: string }
  | { kind: "missing"; text: string }
  | { kind: "example"; materials: ExampleMaterial[]; note: string }
  | { kind: "diff"; changes: CardChange[] }
  | { kind: "explanation"; mechanism: string; assumptions: string | null }
  | { kind: "patch"; excerpt: string; truncated: boolean; note: string }
  | { kind: "output"; label: string; excerpt: string; truncated: boolean; stderr: boolean }
  | {
      kind: "check";
      status: CheckStatus;
      status_text: string;
      tone: "ok" | "warn" | "bad";
      claimed_text: string;
      reason_text: string | null;
      evidence: string | null;
      /** True when the log found the evidence in the execution's output. */
      evidence_verified: boolean;
      output: (Excerpt & { stderr: boolean }) | null;
      limits: string | null;
      /** Paths changed after the execution; null when the check is current or has no execution. */
      changed_since: string[] | null;
    }
  | { kind: "hypothesis_state"; status: "open" | "confirmed" | "rejected"; status_text: string; hypothesis: string; resolution: string | null }
  | { kind: "decision_record"; question: string; quote: string; reading: string; confirmed: boolean };

/** One event of a step with everything the "Źródła" panel shows. */
export interface StepSource {
  event_id: string;
  time: string;
  origin: Origin;
  kind: TaskEvent["kind"];
  sentence: string;
  command: string | null;
  stdout: string | null;
  stderr: string | null;
  /** Text of a user prompt or an agent message. */
  text: string | null;
  code_version: CodeVersion;
  files: string[];
}

export interface TaskStep {
  id: string;
  kind: StepKind;
  /** Time of the step's anchor (for a change: of its first file change); the history is sorted by it. */
  time: string;
  title: string;
  subtitle: string;
  kicker: string;
  /** One or two sentences of explanation; null when the title already says it all. */
  lead: string | null;
  blocks: StepBlock[];
  sources: StepSource[];
  /** Present only for a prepared, unapplied fix: the demonstration decision buttons. */
  decision: { demo: true } | null;
  /** Link to the matching place in the "Kod AI" view. */
  code_link: { target: string; fragments: number } | null;
  /** For a code change: the checks whose execution happened after it (chronology, not causation); null for other steps. */
  checks_after: CheckRef[] | null;
  refs: { hypothesis_id?: string };
}

export interface CheckRef {
  step_id: string;
  title: string;
  status_text: string;
  tone: "ok" | "warn" | "bad";
}

export interface PreviewHeader {
  repo: string | null;
  task_id: string;
  /** Short title: the first sentence or line of the description. */
  title: string;
  /** The full description when it is longer than the title; null otherwise. */
  goal: string | null;
  description: string;
  started: string;
  /** State of execution, from the last event: the agent works, waits for an answer, or the session ended. */
  execution: string;
  /** State of verification: the checks that exist, or that none were recorded. */
  verification: string;
  /** One sentence about what matters now; never mentions empty categories. */
  status_line: string;
  counts: TaskSummary["counts"];
  hypotheses: { open: number; confirmed: number; rejected: number };
  checks: CheckCounts;
  decisions_unconfirmed: number;
  latest_code_version: CodeVersion | null;
}

export interface PreviewModel {
  header: PreviewHeader;
  timeline: TimelineItem[];
  steps: TaskStep[];
  code: {
    cards: CodeCard[];
    unexplained: CardChange[];
    proposals: ProposalItem[];
    diff: FileDiff[];
  };
  checks: {
    items: CheckItem[];
    counts: CheckCounts;
    unassessed_commands: { id: string; time: string; command: string }[];
  };
}

export interface PreviewOptions {
  /** Name of the repository the task belongs to, when known. */
  repo?: string | null;
}

export function buildPreviewModel(task: TaskRecord, events: TaskEvent[], options: PreviewOptions = {}): PreviewModel {
  const summary = summarize(task, events);
  const checks = buildChecks(events, summary);
  const counts = countChecks(checks);
  const steps = buildSteps(events, summary, checks);
  const hypotheses = {
    open: summary.hypotheses.filter((item) => item.status === "open").length,
    confirmed: summary.hypotheses.filter((item) => item.status === "confirmed").length,
    rejected: summary.hypotheses.filter((item) => item.status === "rejected").length,
  };
  const decisionsUnconfirmed = summary.decisions.filter((item) => !item.confirmed).length;
  const { title, goal } = splitTitle(task.description);
  const execution = executionState(events);
  const verification = verificationState(counts);
  return {
    header: {
      repo: options.repo ?? null,
      task_id: task.id,
      title,
      goal,
      description: task.description,
      started: task.started,
      execution,
      verification,
      status_line: statusLine(steps, execution, verification, hypotheses, decisionsUnconfirmed),
      counts: summary.counts,
      hypotheses,
      checks: counts,
      decisions_unconfirmed: decisionsUnconfirmed,
      latest_code_version: summary.latest_code_version,
    },
    timeline: events.map(timelineItem),
    steps,
    code: buildCode(events),
    checks: {
      items: checks,
      counts,
      unassessed_commands: events
        .filter((event): event is CommandRunEvent => event.kind === "command_run")
        .filter((run) => !checks.some((check) => check.execution_id === run.id))
        .map((run) => ({ id: run.id, time: run.time, command: run.command })),
    },
  };
}

// --- header ------------------------------------------------------------------

export const TITLE_LENGTH = 90;

/** The first sentence or line as the title; the whole text as the goal when it says more. */
export function splitTitle(description: string): { title: string; goal: string | null } {
  const text = description.trim();
  if (text.length === 0) return { title: "Zadanie bez opisu", goal: null };
  const firstLine = text.split("\n")[0]!.trim();
  const sentence = firstLine.match(/^(.{10,}?[.!?])(\s|$)/)?.[1] ?? firstLine;
  const title = sentence.length > TITLE_LENGTH ? `${sentence.slice(0, TITLE_LENGTH - 1).trimEnd()}…` : sentence;
  return { title, goal: title === text ? null : text };
}

/** What the agent is doing, read from the last event only; never a guess. */
export function executionState(events: TaskEvent[]): string {
  const last = events.at(-1);
  if (!last) return "Bez zdarzeń";
  if (last.kind === "session_ended") return "Sesja zakończona";
  if (last.kind === "agent_message") return "Agent zakończył turę i czeka na odpowiedź";
  return "Agent pracuje";
}

/** The checks that exist, in plain words, or that none were recorded. */
export function verificationState(counts: CheckCounts): string {
  const parts: string[] = [];
  if (counts.current_passed > 0) parts.push(`${plural(counts.current_passed, "sprawdzenie potwierdza", "sprawdzenia potwierdzają", "sprawdzeń potwierdza")} bieżący kod`);
  if (counts.stale_passed > 0) parts.push(`${plural(counts.stale_passed, "sprawdzenie przeszło", "sprawdzenia przeszły", "sprawdzeń przeszło")} na wcześniejszej wersji kodu`);
  if (counts.failed > 0) parts.push(`${plural(counts.failed, "sprawdzenie nie przeszło", "sprawdzenia nie przeszły", "sprawdzeń nie przeszło")}`);
  if (counts.inconclusive > 0) parts.push(`${counts.inconclusive} nierozstrzygnięte`);
  if (counts.unverified > 0) parts.push(`${plural(counts.unverified, "sprawdzenie niepotwierdzone", "sprawdzenia niepotwierdzone", "sprawdzeń niepotwierdzonych")}`);
  return parts.length > 0 ? parts.join(", ") : "brak zapisanych sprawdzeń";
}

function statusLine(steps: TaskStep[], execution: string, verification: string, hypotheses: PreviewHeader["hypotheses"], decisionsUnconfirmed: number): string {
  if (steps.some((step) => step.decision !== null)) return "Przygotowana poprawka czeka na decyzję · demonstracja, nic nie jest wstrzymane";
  const parts: string[] = [execution, verification];
  if (hypotheses.rejected > 0) parts.push(`${plural(hypotheses.rejected, "podejrzenie odrzucone", "podejrzenia odrzucone", "podejrzeń odrzuconych")}`);
  if (hypotheses.open > 0) parts.push(`${plural(hypotheses.open, "podejrzenie otwarte", "podejrzenia otwarte", "podejrzeń otwartych")}`);
  if (decisionsUnconfirmed > 0) parts.push(`${plural(decisionsUnconfirmed, "decyzja niepotwierdzona cytatem", "decyzje niepotwierdzone cytatem", "decyzji niepotwierdzonych cytatem")}`);
  return parts.join(" · ");
}

// --- timeline (audit data, not shown on the page) ------------------------------

function timelineItem(event: TaskEvent): TimelineItem {
  const refs: TimelineItem["refs"] = {};
  if (event.kind === "hypothesis_resolved") refs.hypothesis_id = event.hypothesis_id;
  if (event.kind === "check" && event.execution_id) refs.execution_id = event.execution_id;
  if (event.kind === "change_explained") refs.change_ids = event.change_ids;
  if (event.kind === "decision" && event.prompt_event_id) refs.prompt_event_id = event.prompt_event_id;
  const sentence =
    event.kind === "hypothesis_resolved"
      ? `Hipoteza ${event.outcome === "confirmed" ? "potwierdzona" : "odrzucona"}: ${oneLine(event.text)}`
      : describeEvent(event);
  return { id: event.id, time: event.time, origin: event.origin, kind: event.kind, sentence, refs };
}

// --- steps -------------------------------------------------------------------

export const EXCERPT_LINES = 5;
export const STEP_TITLE_LENGTH = 70;

/** Polish plural: plural(3, "plik", "pliki", "plików") -> "3 pliki". */
export function plural(count: number, one: string, few: string, many: string): string {
  const last = count % 10;
  const tens = count % 100;
  let word = many;
  if (count === 1) word = one;
  else if (last >= 2 && last <= 4 && (tens < 12 || tens > 14)) word = few;
  return `${count} ${word}`;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function clip(text: string, max = STEP_TITLE_LENGTH): string {
  const line = oneLine(text);
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/** The text as the lead, unless the title already shows all of it. */
function leadUnlessTitled(text: string): string | null {
  return clip(text) === oneLine(text) ? null : text;
}

function excerptOf(text: string): Excerpt {
  const lines = splitLines(text);
  return { excerpt: lines.slice(0, EXCERPT_LINES).join("\n"), truncated: lines.length > EXCERPT_LINES };
}

function exampleBlock(materials: Material[]): StepBlock | null {
  if (materials.length === 0) return null;
  return {
    kind: "example",
    materials: materials.map((material) => ({ label: material.label, nature: material.nature === "observed" ? "tool" : "illustration", ...excerptOf(material.content) })),
    note: "Przykład od AI. Nie jest wynikiem sprawdzenia.",
  };
}

function sourceOf(event: TaskEvent): StepSource {
  return {
    event_id: event.id,
    time: event.time,
    origin: event.origin,
    kind: event.kind,
    sentence: timelineItem(event).sentence,
    command: event.kind === "command_run" ? event.command : null,
    stdout: event.kind === "command_run" ? event.stdout : null,
    stderr: event.kind === "command_run" ? event.stderr : null,
    text: event.kind === "user_prompt" || event.kind === "agent_message" ? event.text : event.kind === "tool_failed" ? JSON.stringify(event.error ?? null, null, 2) : null,
    code_version: event.code_version,
    files: event.files,
  };
}

const CHECK_STATUS_TEXT: Record<CheckStatus, string> = { passed: "przeszło", failed: "nie przeszło", inconclusive: "nierozstrzygnięte", unverified: "niepotwierdzone" };
const CHECK_REASON_TEXT: Record<CheckReason, string> = {
  no_execution: "brak zarejestrowanego wykonania polecenia",
  evidence_not_found: "dowodu nie ma w wyjściu polecenia",
  no_evidence: "nie podano dowodu z wyjścia polecenia",
};
const HYPOTHESIS_STATUS_TEXT = { open: "otwarte", confirmed: "potwierdzone przez AI", rejected: "odrzucone" } as const;

type Pending = TaskEvent[];

const FINDING_KINDS: ReadonlySet<TaskEvent["kind"]> = new Set(["observation", "hypothesis", "hypothesis_resolved", "proposal", "change_prepared", "change_explained", "check", "decision"]);

/**
 * Groups the events into meaningful steps (design D11, D12): the task itself,
 * the agent's findings, code changes and user decisions. A check takes its
 * execution and an explanation its file changes; every other command, tool
 * failure, agent message, user prompt, resume or session end becomes a source
 * of the next step in time (or of the last one). When the agent recorded no
 * finding at all, each command becomes a short factual step of its own
 * instead, built only from what the tool returned. Nothing is guessed.
 */
export function buildSteps(events: TaskEvent[], summary: TaskSummary, checks: CheckItem[]): TaskStep[] {
  const byId = new Map(events.map((event) => [event.id, event]));
  const claimed = new Set<string>();
  for (const event of events) {
    if (event.kind === "check" && event.execution_id && !claimed.has(event.execution_id)) claimed.add(event.execution_id);
    if (event.kind === "change_explained") for (const id of event.change_ids) claimed.add(id);
  }
  const hasFindings = events.some((event) => FINDING_KINDS.has(event.kind));
  const knownFiles = [...new Set(events.flatMap((event) => event.files))];
  const laterChanges = (time: string, files: string[] | null): FileChangedEvent[] =>
    events.filter((event): event is FileChangedEvent => event.kind === "file_changed" && event.time > time && (files === null || files.length === 0 || files.includes(event.path)));

  const steps: TaskStep[] = [];
  let pending: Pending = [];
  let unexplained: FileChangedEvent[] = [];

  const flushUnexplained = (): void => {
    if (unexplained.length === 0) return;
    const step = unexplainedStep(unexplained);
    attach(step, pending);
    pending = [];
    steps.push(step);
    unexplained = [];
  };

  for (const event of events) {
    if (event.kind === "file_changed" && !claimed.has(event.id)) {
      unexplained.push(event);
      continue;
    }
    if (event.kind === "file_changed" || event.kind === "command_run" || event.kind === "tool_failed") {
      if (!claimed.has(event.id)) {
        flushUnexplained();
        if (!hasFindings && event.kind !== "file_changed") {
          const step = toolRunStep(event, knownFiles);
          attach(step, pending);
          pending = [];
          steps.push(step);
        } else {
          pending.push(event);
        }
      }
      continue;
    }
    if (event.kind === "agent_message" || event.kind === "user_prompt" || event.kind === "session_resumed" || event.kind === "session_ended") {
      flushUnexplained();
      pending.push(event);
      continue;
    }
    flushUnexplained();
    const step = anchoredStep(event, byId, summary, checks, laterChanges);
    if (!step) continue;
    attach(step, pending);
    pending = [];
    steps.push(step);
  }
  flushUnexplained();
  steps.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
  // Whatever happened after the last finding belongs to the step that is last in the history.
  if (pending.length > 0 && steps.length > 0) attach(steps.at(-1)!, pending);

  const taskStep = steps.find((step) => step.kind === "task");
  if (taskStep && !hasFindings) {
    taskStep.blocks.push({ kind: "note", text: "AI nie zapisało żadnych ustaleń w tym zadaniu. Kolejne kroki są odtworzone z tego, co zarejestrowały narzędzia; polecenia i wypowiedzi agenta są w źródłach." });
  }

  // Checks are listed at the code changes that precede their execution: chronology, not causation.
  const checkRefs = steps
    .filter((step) => step.kind === "check")
    .map((step) => {
      const result = step.blocks.find((item): item is Extract<StepBlock, { kind: "check" }> => item.kind === "check")!;
      return { time: step.time, ref: { step_id: step.id, title: step.title, status_text: result.status_text, tone: result.tone } };
    });
  for (const step of steps) {
    if (step.kind === "change" || step.kind === "unexplained_change") {
      step.checks_after = checkRefs.filter((item) => item.time > step.time).map((item) => item.ref);
    }
  }
  return steps;
}

/** A path mentioned in a command, when one token looks like a file: known task files first. Null when nothing qualifies. */
export function pathInCommand(command: string, knownFiles: string[]): string | null {
  const tokens = command
    .split(/\s+/)
    .map((token) => token.replace(/^["'`(]+/, "").replace(/["'`);,]+$/, ""))
    .filter((token) => token.length > 0 && !token.startsWith("-") && !/^https?:/.test(token));
  const candidates = tokens
    .map((token) => token.replaceAll("\\", "/"))
    .filter((token) => !token.endsWith("/") && /\.[a-z0-9]{1,6}$/i.test(token.split("/").at(-1) ?? "") && !/^\d+(\.\d+)*$/.test(token));
  const known = candidates.find((token) => knownFiles.some((file) => file === token || file.endsWith(`/${token}`) || token.endsWith(`/${file}`)));
  return known ?? candidates[0] ?? null;
}

const SUBTITLE_LENGTH = 40;

function toolRunStep(event: TaskEvent, knownFiles: string[]): TaskStep {
  if (event.kind === "tool_failed") {
    const text = typeof event.error === "string" ? event.error : JSON.stringify(event.error ?? null);
    return {
      id: `run-${event.id}`,
      kind: "tool_run",
      time: event.time,
      title: `Narzędzie ${event.tool} zgłosiło błąd`,
      subtitle: "Błąd narzędzia",
      kicker: "Działanie narzędzia · bez zapisanego celu",
      lead: "AI użyło narzędzia, które zgłosiło błąd; nie zapisało, po co ani co miało z tego wynikać.",
      blocks: [{ kind: "output", label: "błąd narzędzia", stderr: true, ...excerptOf(text) }],
      sources: [sourceOf(event)],
      decision: null,
      code_link: null,
      checks_after: null,
      refs: {},
    };
  }
  const run = event as CommandRunEvent;
  const path = pathInCommand(run.command, knownFiles);
  const stdoutFirst = splitLines(run.stdout)[0] ?? "";
  const stderrFirst = splitLines(run.stderr)[0] ?? "";
  const subtitle = stdoutFirst.length > 0 ? `wyjście: „${clip(stdoutFirst, SUBTITLE_LENGTH)}”` : stderrFirst.length > 0 ? `błąd: „${clip(stderrFirst, SUBTITLE_LENGTH)}”` : "bez wyjścia";
  const source = run.stdout.length > 0 ? run.stdout : run.stderr;
  const blocks: StepBlock[] =
    source.length > 0
      ? [{ kind: "output", label: run.stdout.length > 0 ? "wyjście polecenia" : "wyjście błędów polecenia", stderr: run.stdout.length === 0, ...excerptOf(source) }]
      : [{ kind: "note", text: "Polecenie nic nie wypisało; kod wyjścia jest nieznany." }];
  return {
    id: `run-${run.id}`,
    kind: "tool_run",
    time: run.time,
    title: path ? `Polecenie na ${path}` : "Polecenie",
    subtitle,
    kicker: "Polecenie · bez zapisanego celu",
    lead: "AI uruchomiło polecenie; nie zapisało, po co ani co miało z tego wynikać. Poniżej tylko to, co polecenie wypisało.",
    blocks,
    sources: [sourceOf(run)],
    decision: null,
    code_link: null,
    checks_after: null,
    refs: {},
  };
}

function attach(step: TaskStep, pending: Pending): void {
  for (const event of pending) step.sources.push(sourceOf(event));
  step.sources.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
}

function unexplainedStep(changes: FileChangedEvent[]): TaskStep {
  const paths = [...new Set(changes.map((change) => change.path))];
  const allCreated = changes.every((change) => change.created);
  const title = paths.length === 1 ? `${allCreated ? "Utworzono" : "Zmieniono"} plik ${paths[0]}` : `${allCreated ? "Utworzono" : "Zmieniono"} ${plural(paths.length, "plik", "pliki", "plików")}`;
  return {
    id: `change-${changes[0]!.id}`,
    kind: "unexplained_change",
    time: changes[0]!.time,
    title,
    subtitle: "Bez objaśnienia od AI",
    kicker: `Zmiana w kodzie · ${plural(changes.length, "fragment", "fragmenty", "fragmentów")} · bez objaśnienia od AI`,
    lead: "AI zmieniło ten kod narzędziem, ale nie zapisało, po co i jak to działa. Poniżej dokładnie to, co zarejestrowało narzędzie.",
    blocks: [{ kind: "diff", changes: changes.map(cardChange) }],
    sources: changes.map(sourceOf),
    decision: null,
    code_link: { target: `u-${changes[0]!.id}`, fragments: changes.length },
    checks_after: [],
    refs: {},
  };
}

function anchoredStep(
  event: TaskEvent,
  byId: Map<string, TaskEvent>,
  summary: TaskSummary,
  checks: CheckItem[],
  laterChanges: (time: string, files: string[] | null) => FileChangedEvent[],
): TaskStep | null {
  const base = { id: event.id, time: event.time, blocks: [] as StepBlock[], sources: [sourceOf(event)], decision: null, code_link: null, checks_after: null, refs: {} };
  switch (event.kind) {
    case "task_started":
      return { ...base, kind: "task", title: "Zgłoszono zadanie", subtitle: "Opis od użytkownika", kicker: "Zadanie · zgłoszone przez użytkownika", lead: event.description };
    case "observation": {
      const example = exampleBlock(event.materials);
      return {
        ...base,
        kind: "observation",
        title: clip(event.text),
        subtitle: event.materials.length > 0 ? `Obserwacja · ${plural(event.materials.length, "przykład", "przykłady", "przykładów")} od AI` : "Obserwacja AI",
        kicker: "Obserwacja AI",
        lead: leadUnlessTitled(event.text),
        blocks: example ? [example] : [],
      };
    }
    case "hypothesis": {
      const state = summary.hypotheses.find((item) => item.id === event.id);
      const status = state?.status ?? "open";
      return {
        ...base,
        kind: "hypothesis",
        title: clip(event.text),
        subtitle: `Podejrzenie · ${HYPOTHESIS_STATUS_TEXT[status]}`,
        kicker: `Podejrzenie AI · ${HYPOTHESIS_STATUS_TEXT[status]}`,
        lead: leadUnlessTitled(event.text),
        blocks: [{ kind: "hypothesis_state", status, status_text: HYPOTHESIS_STATUS_TEXT[status], hypothesis: event.text, resolution: state?.resolution?.text ?? null }],
      };
    }
    case "hypothesis_resolved": {
      const hypothesis = byId.get(event.hypothesis_id);
      const rejected = event.outcome === "rejected";
      const text = hypothesis && hypothesis.kind === "hypothesis" ? hypothesis.text : event.hypothesis_id;
      return {
        ...base,
        kind: "resolution",
        title: rejected ? "Odrzucono podejrzenie" : "Potwierdzono podejrzenie",
        subtitle: clip(event.text, 50),
        kicker: `Rozstrzygnięcie podejrzenia · ${rejected ? "odrzucone" : "potwierdzone przez AI, nie przez sprawdzenie"}`,
        lead: event.text,
        blocks: [{ kind: "hypothesis_state", status: event.outcome, status_text: HYPOTHESIS_STATUS_TEXT[event.outcome], hypothesis: text, resolution: event.text }],
        refs: { hypothesis_id: event.hypothesis_id },
      };
    }
    case "proposal": {
      const later = laterChanges(event.time, null);
      const example = exampleBlock(event.materials);
      return {
        ...base,
        kind: "proposal",
        title: clip(event.text),
        subtitle: "Propozycja",
        kicker: later.length > 0 ? `Propozycja · później zmieniono ${plural(new Set(later.map((change) => change.path)).size, "plik", "pliki", "plików")}` : "Propozycja · pliki jeszcze bez zmian",
        lead: leadUnlessTitled(event.text),
        blocks: example ? [example] : [],
      };
    }
    case "change_prepared": {
      const later = laterChanges(event.time, event.files);
      const pendingDecision = later.length === 0;
      const blocks: StepBlock[] = [];
      if (event.patch) blocks.push({ kind: "patch", ...excerptOf(event.patch), note: "Łatka przygotowana przez AI. Nie została zastosowana przez żadne narzędzie." });
      const example = exampleBlock(event.materials);
      if (example) blocks.push(example);
      return {
        ...base,
        kind: "prepared",
        title: "Przygotowano poprawkę",
        subtitle: pendingDecision ? "Oczekuje na decyzję (demonstracja)" : "Później zmieniono pliki",
        kicker: pendingDecision ? "Przygotowana poprawka · pliki jeszcze bez zmian" : `Przygotowana poprawka · później zmieniono ${plural(new Set(later.map((change) => change.path)).size, "plik", "pliki", "plików")}`,
        lead: event.text,
        blocks,
        decision: pendingDecision ? { demo: true } : null,
      };
    }
    case "change_explained": {
      const changes = event.change_ids.map((id) => byId.get(id)).filter((item): item is FileChangedEvent => item !== undefined && item.kind === "file_changed");
      const blocks: StepBlock[] = [];
      if (changes.length > 0) blocks.push({ kind: "diff", changes: changes.map(cardChange) });
      else blocks.push({ kind: "missing", text: "Żadna zmiana wykonana narzędziem nie pasuje do tego objaśnienia, więc nie ma fragmentu „po poprawce” do pokazania." });
      blocks.push({ kind: "explanation", mechanism: event.mechanism, assumptions: event.assumptions.trim().length > 0 ? event.assumptions : null });
      const example = exampleBlock(event.materials);
      if (example) blocks.push(example);
      return {
        ...base,
        time: changes[0]?.time ?? event.time,
        kind: "change",
        title: event.title,
        subtitle: changes.length > 0 ? `${plural(changes.length, "fragment", "fragmenty", "fragmentów")} kodu` : "Bez zarejestrowanej zmiany",
        kicker: changes.length > 0 ? `Zmiana w kodzie · ${plural(changes.length, "fragment", "fragmenty", "fragmentów")} · po poprawce` : "Objaśnienie · bez zarejestrowanej zmiany pliku",
        lead: event.purpose,
        blocks,
        sources: [...changes.map(sourceOf), sourceOf(event)],
        code_link: { target: `card-${event.id}`, fragments: changes.length },
        checks_after: [],
      };
    }
    case "check": {
      const item = checks.find((check) => check.id === event.id);
      const execution = event.execution_id ? byId.get(event.execution_id) : undefined;
      const run = execution && execution.kind === "command_run" ? execution : null;
      const stale = event.status === "passed" && item !== undefined && !item.current;
      const verified = event.status !== "unverified";
      const tone: "ok" | "warn" | "bad" = event.status === "passed" ? (stale ? "warn" : "ok") : event.status === "failed" ? "bad" : "warn";
      const statusText = stale ? "przeszło na wcześniejszej wersji kodu" : CHECK_STATUS_TEXT[event.status];
      const output = run ? { ...excerptOf(run.stdout.length > 0 ? run.stdout : run.stderr), stderr: run.stdout.length === 0 && run.stderr.length > 0 } : null;
      const blocks: StepBlock[] = [
        {
          kind: "check",
          status: event.status,
          status_text: statusText,
          tone,
          claimed_text: CHECK_STATUS_TEXT[event.claimed],
          reason_text: event.reason ? CHECK_REASON_TEXT[event.reason] : null,
          evidence: event.evidence.trim().length > 0 ? event.evidence : null,
          evidence_verified: verified,
          output,
          limits: event.limits ?? null,
          changed_since: stale ? item!.changed_since : null,
        },
      ];
      if (!run) blocks.push({ kind: "missing", text: "Nie zarejestrowano wykonania tego polecenia w zadaniu, więc wynik jest tylko deklaracją AI." });
      return {
        ...base,
        time: run?.time ?? event.time,
        kind: "check",
        title: clip(event.what),
        subtitle: `Sprawdzenie · ${statusText}`,
        kicker: `Sprawdzenie · ${statusText}`,
        lead: `Oczekiwano: ${oneLine(event.expected)}`,
        blocks,
        sources: run ? [sourceOf(run), sourceOf(event)] : [sourceOf(event)],
      };
    }
    case "decision":
      return {
        ...base,
        kind: "decision",
        title: "Decyzja użytkownika",
        subtitle: event.confirmed ? "Potwierdzona cytatem" : "Niepotwierdzona",
        kicker: `Decyzja użytkownika · ${event.confirmed ? "potwierdzona słowami użytkownika" : "niepotwierdzona: cytatu nie ma w wypowiedziach użytkownika"}`,
        lead: event.question,
        blocks: [{ kind: "decision_record", question: event.question, quote: event.quote, reading: event.reading, confirmed: event.confirmed }],
      };
    default:
      return null;
  }
}

// --- code --------------------------------------------------------------------

function buildCode(events: TaskEvent[]): PreviewModel["code"] {
  const changes = events.filter((event): event is FileChangedEvent => event.kind === "file_changed");
  const byId = new Map(changes.map((change) => [change.id, change]));
  const covered = new Set<string>();

  const cards: CodeCard[] = events
    .filter((event): event is ChangeExplainedEvent => event.kind === "change_explained")
    .map((explained) => {
      const matched = explained.change_ids.map((id) => byId.get(id)).filter((change): change is FileChangedEvent => change !== undefined);
      for (const change of matched) covered.add(change.id);
      return {
        id: explained.id,
        time: explained.time,
        title: explained.title,
        purpose: explained.purpose,
        mechanism: explained.mechanism,
        assumptions: explained.assumptions,
        materials: explained.materials,
        files: explained.files,
        changes: matched.map(cardChange),
        unmatched: matched.length === 0,
      };
    });

  const proposals: ProposalItem[] = events
    .filter((event): event is ChangePreparedEvent => event.kind === "change_prepared")
    .map((prepared) => ({ id: prepared.id, time: prepared.time, text: prepared.text, patch: prepared.patch, materials: prepared.materials, files: prepared.files }));

  return {
    cards,
    unexplained: changes.filter((change) => !covered.has(change.id)).map(cardChange),
    proposals,
    diff: buildDiff(changes),
  };
}

function cardChange(change: FileChangedEvent): CardChange {
  const hunks = hunksOf(change.patch);
  const first = hunks[0];
  return {
    event_id: change.id,
    time: change.time,
    path: change.path,
    created: change.created,
    tool: change.tool,
    before: change.before,
    after: change.after,
    lines: first ? { start: first.newStart, end: first.newStart + Math.max(first.newLines, 1) - 1 } : null,
    code_version: change.code_version,
  };
}

interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

/** The hunks of a `structuredPatch` as Claude Code returned them, or none when the shape is not the expected one. */
export function hunksOf(patch: unknown): Hunk[] {
  if (!Array.isArray(patch)) return [];
  const hunks: Hunk[] = [];
  for (const item of patch) {
    if (
      typeof item === "object" &&
      item !== null &&
      typeof (item as Hunk).oldStart === "number" &&
      typeof (item as Hunk).newStart === "number" &&
      Array.isArray((item as Hunk).lines) &&
      (item as Hunk).lines.every((line) => typeof line === "string")
    ) {
      const hunk = item as Hunk;
      hunks.push({
        oldStart: hunk.oldStart,
        oldLines: typeof hunk.oldLines === "number" ? hunk.oldLines : hunk.lines.filter((line) => !line.startsWith("+")).length,
        newStart: hunk.newStart,
        newLines: typeof hunk.newLines === "number" ? hunk.newLines : hunk.lines.filter((line) => !line.startsWith("-")).length,
        lines: hunk.lines,
      });
    } else {
      return [];
    }
  }
  return hunks;
}

/** One unified diff per file, all recorded changes of the file in order. Built only from tool data. */
export function buildDiff(changes: FileChangedEvent[]): FileDiff[] {
  const order: string[] = [];
  const parts = new Map<string, { chunks: string[]; partial: boolean }>();
  for (const change of changes) {
    let entry = parts.get(change.path);
    if (!entry) {
      entry = { chunks: [], partial: false };
      parts.set(change.path, entry);
      order.push(change.path);
    }
    const hunks = hunksOf(change.patch);
    if (hunks.length > 0) {
      for (const hunk of hunks) {
        entry.chunks.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`, ...hunk.lines);
      }
    } else if (change.created && change.after !== null) {
      const lines = splitLines(change.after);
      entry.chunks.push(`@@ -0,0 +1,${lines.length} @@`, ...lines.map((line) => `+${line}`));
    } else {
      entry.partial = true;
      entry.chunks.push("# łatka niedostępna, pokazano fragment przed i po");
      for (const line of splitLines(change.before ?? "")) entry.chunks.push(`-${line}`);
      for (const line of splitLines(change.after ?? "")) entry.chunks.push(`+${line}`);
    }
  }
  return order.map((path) => {
    const entry = parts.get(path)!;
    const header = changes.find((change) => change.path === path)!.created ? `--- /dev/null\n+++ b/${path}` : `--- a/${path}\n+++ b/${path}`;
    return { path, text: `${header}\n${entry.chunks.join("\n")}`, partial: entry.partial };
  });
}

function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

// --- checks ------------------------------------------------------------------

function buildChecks(events: TaskEvent[], summary: TaskSummary): CheckItem[] {
  return events
    .filter((event): event is CheckEvent => event.kind === "check")
    .map((check) => {
      const state = summary.checks.find((item) => item.id === check.id);
      const index = check.execution_id ? events.findIndex((item) => item.id === check.execution_id) : -1;
      const execution = index >= 0 ? events[index]! : null;
      const current = state?.current ?? false;
      const changedSince =
        execution && !current
          ? [...new Set(events.slice(index + 1).filter((item): item is FileChangedEvent => item.kind === "file_changed").map((item) => item.path))]
          : [];
      return {
        id: check.id,
        time: check.time,
        what: check.what,
        expected: check.expected,
        command: check.command,
        evidence: check.evidence,
        claimed: check.claimed,
        status: check.status,
        reason: check.reason,
        limits: check.limits ?? null,
        execution_id: check.execution_id,
        code_version: execution ? execution.code_version : null,
        current,
        changed_since: changedSince,
      };
    });
}

function countChecks(checks: CheckItem[]): CheckCounts {
  const counts: CheckCounts = { current_passed: 0, stale_passed: 0, failed: 0, inconclusive: 0, unverified: 0 };
  for (const check of checks) {
    if (check.status === "passed") {
      if (check.current) counts.current_passed += 1;
      else counts.stale_passed += 1;
    } else if (check.status === "failed") counts.failed += 1;
    else if (check.status === "inconclusive") counts.inconclusive += 1;
    else counts.unverified += 1;
  }
  return counts;
}

export { sameCodeVersion };
