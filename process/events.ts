// Event model of the DevGuide task log. One task (started with /devguide)
// is a sequence of events, each with an origin, a time, related files and
// the code version it happened on. Events recorded by tools (file changes,
// commands) and events recorded by the agent (findings) share the envelope
// but differ in `origin`, so observations and interpretations never mix.
//
// The types are a discriminated union on `kind`; no enums, because Node
// strips types only (erasableSyntaxOnly).

import { randomBytes } from "node:crypto";

/** Where the information in an event comes from. */
export type Origin = "user" | "tool" | "agent" | "devguide";

/** Commit plus a fingerprint of the working tree; both null when unknown. */
export interface CodeVersion {
  commit: string | null;
  working_tree: string | null;
}

/** Something attached to an event: an example, a snippet, a sample output. */
export interface Material {
  label: string;
  content: string;
  /** `illustration` for anything the agent supplied; `observed` only for tool output. */
  nature: "illustration" | "observed";
}

export interface EventEnvelope {
  id: string;
  /** ISO 8601 time of recording. */
  time: string;
  task_id: string;
  session_id: string | null;
  origin: Origin;
  code_version: CodeVersion;
  /** Paths the event is about, relative to the repository when possible. */
  files: string[];
}

export interface TaskStartedEvent extends EventEnvelope {
  kind: "task_started";
  origin: "user";
  description: string;
}

export interface UserPromptEvent extends EventEnvelope {
  kind: "user_prompt";
  origin: "user";
  text: string;
}

export interface SessionResumedEvent extends EventEnvelope {
  kind: "session_resumed";
  origin: "devguide";
  /** `source` of the SessionStart hook: `resume`, `startup`, `compact`, ... */
  source: string;
}

export interface SessionEndedEvent extends EventEnvelope {
  kind: "session_ended";
  origin: "devguide";
  /** `reason` of the SessionEnd hook: `other`, `clear`, `logout`, ... */
  reason: string;
}

export interface ObservationEvent extends EventEnvelope {
  kind: "observation";
  origin: "agent";
  text: string;
  materials: Material[];
}

export interface HypothesisEvent extends EventEnvelope {
  kind: "hypothesis";
  origin: "agent";
  text: string;
}

export type HypothesisOutcome = "confirmed" | "rejected";

export interface HypothesisResolvedEvent extends EventEnvelope {
  kind: "hypothesis_resolved";
  origin: "agent";
  hypothesis_id: string;
  outcome: HypothesisOutcome;
  text: string;
}

export interface ProposalEvent extends EventEnvelope {
  kind: "proposal";
  origin: "agent";
  text: string;
  materials: Material[];
}

export interface ChangePreparedEvent extends EventEnvelope {
  kind: "change_prepared";
  origin: "agent";
  text: string;
  patch: string | null;
  materials: Material[];
}

/**
 * The agent's explanation of one logical fix: what it is for, how it works,
 * what it assumes. Tied at recording time to the `file_changed` events it
 * covers; an empty `change_ids` means no recorded change matched.
 */
export interface ChangeExplainedEvent extends EventEnvelope {
  kind: "change_explained";
  origin: "agent";
  title: string;
  purpose: string;
  mechanism: string;
  /** Assumptions and limits in plain language; empty when none were given. */
  assumptions: string;
  materials: Material[];
  /** Ids of the `file_changed` events this explanation covers. */
  change_ids: string[];
}

export interface FileChangedEvent extends EventEnvelope {
  kind: "file_changed";
  origin: "tool";
  path: string;
  created: boolean;
  before: string | null;
  after: string | null;
  /** Unified hunks as the tool returned them, when it did. */
  patch: unknown;
  tool: string;
}

export interface CommandRunEvent extends EventEnvelope {
  kind: "command_run";
  origin: "tool";
  command: string;
  stdout: string;
  stderr: string;
  interrupted: boolean;
  /** Claude Code does not report it; always null so far. */
  exit_code: number | null;
}

export interface ToolFailedEvent extends EventEnvelope {
  kind: "tool_failed";
  origin: "tool";
  tool: string;
  input: unknown;
  error: unknown;
}

export interface DecisionEvent extends EventEnvelope {
  kind: "decision";
  origin: "agent";
  question: string;
  /** The user's answer as quoted by the agent. */
  quote: string;
  /** The agent's reading of the answer. */
  reading: string;
  /** True only when `quote` occurs in a recorded user prompt of this task. */
  confirmed: boolean;
  prompt_event_id: string | null;
}

export type CheckClaim = "passed" | "failed" | "inconclusive";
export type CheckStatus = CheckClaim | "unverified";
export type CheckReason = "no_execution" | "evidence_not_found" | "no_evidence";

export interface CheckEvent extends EventEnvelope {
  kind: "check";
  origin: "agent";
  /** What was checked, in plain language. */
  what: string;
  expected: string;
  command: string;
  /** Text quoted from the command output that supports the claim. */
  evidence: string;
  claimed: CheckClaim;
  /** The claim when an execution exists and the evidence is in its output, else `unverified`. */
  status: CheckStatus;
  execution_id: string | null;
  reason: CheckReason | null;
  /** Limits of the check as stated by the agent; null when none were given (also for events recorded before the field existed). */
  limits: string | null;
}

export interface AgentMessageEvent extends EventEnvelope {
  kind: "agent_message";
  origin: "agent";
  text: string;
}

export type TaskEvent =
  | TaskStartedEvent
  | UserPromptEvent
  | SessionResumedEvent
  | SessionEndedEvent
  | ObservationEvent
  | HypothesisEvent
  | HypothesisResolvedEvent
  | ProposalEvent
  | ChangePreparedEvent
  | ChangeExplainedEvent
  | FileChangedEvent
  | CommandRunEvent
  | ToolFailedEvent
  | DecisionEvent
  | CheckEvent
  | AgentMessageEvent;

export type EventKind = TaskEvent["kind"];

/** Kinds the agent may record through the CLI. */
export const AGENT_KINDS = [
  "observation",
  "hypothesis",
  "hypothesis_resolved",
  "proposal",
  "change_prepared",
  "change_explained",
  "decision",
  "check",
] as const;

export type AgentKind = (typeof AGENT_KINDS)[number];

export const ALL_KINDS: readonly EventKind[] = [
  "task_started",
  "user_prompt",
  "session_resumed",
  "session_ended",
  ...AGENT_KINDS,
  "file_changed",
  "command_run",
  "tool_failed",
  "agent_message",
];

export const ORIGIN_OF_KIND: Record<EventKind, Origin> = {
  task_started: "user",
  user_prompt: "user",
  session_resumed: "devguide",
  session_ended: "devguide",
  observation: "agent",
  hypothesis: "agent",
  hypothesis_resolved: "agent",
  proposal: "agent",
  change_prepared: "agent",
  change_explained: "agent",
  file_changed: "tool",
  command_run: "tool",
  tool_failed: "tool",
  decision: "agent",
  check: "agent",
  agent_message: "agent",
};

export const CHECK_CLAIMS: readonly CheckClaim[] = ["passed", "failed", "inconclusive"];
export const HYPOTHESIS_OUTCOMES: readonly HypothesisOutcome[] = ["confirmed", "rejected"];

/** Non-empty string fields each kind needs before it can be recorded. */
const REQUIRED_TEXT: Record<EventKind, readonly string[]> = {
  task_started: ["description"],
  user_prompt: ["text"],
  session_resumed: ["source"],
  session_ended: ["reason"],
  observation: ["text"],
  hypothesis: ["text"],
  hypothesis_resolved: ["hypothesis_id", "outcome", "text"],
  proposal: ["text"],
  change_prepared: ["text"],
  change_explained: ["title", "purpose", "mechanism"],
  file_changed: ["path", "tool"],
  command_run: ["command"],
  tool_failed: ["tool"],
  decision: ["question", "quote", "reading"],
  check: ["what", "expected", "command", "claimed"],
  agent_message: ["text"],
};

/** Fields of a draft event: everything except the envelope. */
export type Draft = Record<string, unknown>;

/**
 * Returns the problems that stop a draft of `kind` from being recorded:
 * a missing or empty required field, or a value outside its allowed set.
 * An empty array means the draft is complete.
 */
export function validateDraft(kind: string, draft: Draft): string[] {
  if (!(ALL_KINDS as readonly string[]).includes(kind)) {
    return [`unknown event kind "${kind}"`];
  }
  const problems: string[] = [];
  for (const field of REQUIRED_TEXT[kind as EventKind]) {
    const value = draft[field];
    if (typeof value !== "string" || value.trim().length === 0) {
      problems.push(`missing required field "${field}"`);
    }
  }
  if (kind === "check" && typeof draft["claimed"] === "string" && !(CHECK_CLAIMS as readonly string[]).includes(draft["claimed"])) {
    problems.push(`"claimed" must be one of ${CHECK_CLAIMS.join(", ")}`);
  }
  if (
    kind === "hypothesis_resolved" &&
    typeof draft["outcome"] === "string" &&
    !(HYPOTHESIS_OUTCOMES as readonly string[]).includes(draft["outcome"])
  ) {
    problems.push(`"outcome" must be one of ${HYPOTHESIS_OUTCOMES.join(", ")}`);
  }
  if (draft["files"] !== undefined && !isStringArray(draft["files"])) {
    problems.push(`"files" must be a list of paths`);
  }
  if (draft["materials"] !== undefined && !isMaterialArray(draft["materials"])) {
    problems.push(`"materials" must be a list of { label, content }`);
  }
  if (draft["change_ids"] !== undefined && !isStringArray(draft["change_ids"])) {
    problems.push(`"change_ids" must be a list of event ids`);
  }
  return problems;
}

export function isAgentKind(kind: string): kind is AgentKind {
  return (AGENT_KINDS as readonly string[]).includes(kind);
}

/** Eight hex characters: short enough to quote, random enough for one task. */
export function newEventId(): string {
  return randomBytes(4).toString("hex");
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isMaterialArray(value: unknown): value is Material[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as Material).label === "string" &&
        typeof (item as Material).content === "string",
    )
  );
}
