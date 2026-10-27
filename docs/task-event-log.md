# Task event log

How DevGuide records the course of one task: what the agent observed, assumed, changed, asked and checked, with the origin of every piece of information, its time, the related files and the version of the code. Stage 3 of the [plan](devguide-plan.md). The code is in [process/](../process/README.md); the Claude Code hook that feeds it is described in [claude-code-integration.md](claude-code-integration.md).

## Where the data lives

Everything sits in one data directory: `DEVGUIDE_DIR` when set, otherwise `.devguide/` in the working directory of the session. The directory is ignored by Git.

| Path | Content |
| --- | --- |
| `events.jsonl` | Raw hook log: every hook event with its payload unchanged (stage 2). The full audit trail. |
| `current-task` | Id of the open task. Overwritten by the next `/devguide`. |
| `tasks/<task-id>/task.json` | `id`, `description`, `started`, `session_ids`. |
| `tasks/<task-id>/events.jsonl` | The task log: one JSON object per line, appended only, never rewritten. |

A task starts when the user types `/devguide <description>` and stays open until the next `/devguide`. Tool calls in a session without an open task go to the raw log only. The task id looks like `20261021-2141-1e78` (date, time, four random hex characters), so task directories sort by time and are not confused with session ids: one task can span several sessions after a resume.

## The event envelope

Every event has these fields:

| Field | Meaning |
| --- | --- |
| `id` | Eight hex characters, unique within the task. The CLI prints it when it records an event. |
| `time` | ISO 8601 time of recording. |
| `task_id` | The task. |
| `session_id` | Claude Code session that produced the event, or null. |
| `origin` | `user` (text the user typed), `tool` (what a Claude Code tool returned), `agent` (a finding the agent recorded), `devguide` (bookkeeping, for example a resume). |
| `code_version` | `{ commit, working_tree }`: the commit and a SHA-256 fingerprint of the working tree (diff against HEAD plus the content of untracked, non-ignored files). Both null outside Git. |
| `files` | Related paths, relative to the working directory when possible. |
| `kind` | One of the kinds below. |

Origin is decided by who wrote the event, not by what it claims: a tool result stays `tool` even when the agent paraphrases it later, and a finding stays `agent` even when it quotes a result.

The working-tree fingerprint exists because the agent's changes are uncommitted while it works, so a commit alone would make every event of a task look like the same code. Two events have the same code version only when both commit and fingerprint are equal. Files inside an ignored directory, such as `.devguide/` itself, do not change the fingerprint.

## Kinds of events

| `kind` | `origin` | Fields beyond the envelope | Written by |
| --- | --- | --- | --- |
| `task_started` | `user` | `description` | hook, on `/devguide` |
| `user_prompt` | `user` | `text` | hook, on every later prompt in the task |
| `session_resumed` | `devguide` | `source` (`resume`, `startup`, ...) | hook, on `SessionStart` with an open task |
| `session_ended` | `devguide` | `reason` (`other`, `clear`, `logout`, ...) | hook, on `SessionEnd` with an open task; lets the preview tell a closed session from a working agent |
| `observation` | `agent` | `text`, `materials` | CLI |
| `hypothesis` | `agent` | `text` | CLI |
| `hypothesis_resolved` | `agent` | `hypothesis_id`, `outcome` (`confirmed`, `rejected`), `text` | CLI |
| `proposal` | `agent` | `text`, `materials` | CLI |
| `change_prepared` | `agent` | `text`, `patch`, `materials` | CLI |
| `change_explained` | `agent` | `title`, `purpose`, `mechanism`, `assumptions`, `materials`, `change_ids` | CLI |
| `file_changed` | `tool` | `path`, `created`, `before`, `after`, `patch`, `tool` | hook, from `PostToolUse` of `Write` and `Edit` |
| `command_run` | `tool` | `command`, `stdout`, `stderr`, `interrupted`, `exit_code` | hook, from `PostToolUse` of `Bash` |
| `tool_failed` | `tool` | `tool`, `input`, `error` | hook, from `PostToolUseFailure` |
| `decision` | `agent` | `question`, `quote`, `reading`, `confirmed`, `prompt_event_id` | CLI |
| `check` | `agent` | `what`, `expected`, `command`, `evidence`, `claimed`, `status`, `execution_id`, `reason`, `limits` | CLI |
| `agent_message` | `agent` | `text` | hook, from `Stop` (the agent's last message of a turn) |

`exit_code` is always null so far: Claude Code does not report it, and DevGuide records that as unknown rather than as 0. A Bash call that invokes `process/cli.ts record` is not turned into a `command_run`: the finding it records is the event. The raw log still has the call.

`materials` is a list of `{ label, content, nature }`. Everything attached through the CLI has `nature: "illustration"`: an example the agent chose to show. Real results are the `stdout` and `stderr` of `command_run` events and the `before` and `after` of `file_changed` events, which only tools write.

## Rules applied when recording

The writer applies these rules; a prompt cannot switch them off.

**A check is `passed` only with a recorded execution and evidence from its output.** The agent records a check with the exact command it ran, a quote from the output (`evidence`) and the verdict it claims (`passed`, `failed` or `inconclusive`). The log looks for the latest `command_run` in the task with the same command (or the one named by `--execution <id>`). The recorded `status` equals the claim only when that execution exists and the evidence occurs in its `stdout` or `stderr`. Otherwise the check is kept, with `status: "unverified"` and a `reason`:

| `reason` | Meaning |
| --- | --- |
| `no_execution` | No `command_run` with that command in the task. |
| `no_evidence` | The command ran, but no output was quoted. "It exited" is not a result. |
| `evidence_not_found` | The quoted text is not in the recorded output. |

The rule guarantees that evidence comes from a real run. It does not judge whether the evidence proves the expectation; that remains the reader's call, which is why `what` and `expected` are written in plain language. The optional `limits` is the agent's own statement of what the check does not cover (for example "synthetic data, no filters"); it is shown next to the result and never changes the status.

**An explanation of a fix is tied to recorded file changes.** `change_explained` is how the agent says what a logical fix is for (`purpose`), how it works (`mechanism`) and what it assumes (`assumptions`), with an optional example as a material. At recording time the log fills `change_ids` with the `file_changed` events the explanation covers: the ids given with `--changes` (each must exist in the task, otherwise nothing is written), or else every earlier change of one of the `--files` that no earlier explanation already covers. No match is not an error: the event is kept with an empty `change_ids` and the preview shows it as an explanation without a recorded change. Snippets, patches and line numbers on a card always come from the `file_changed` events, never from the explanation.

**A decision is `confirmed` only by the user's own words.** A decision carries the agent's `reading` and a `quote`. The log marks it `confirmed: true` and sets `prompt_event_id` only when the quote occurs in a `user_prompt` or in the task description. Otherwise it is recorded as unconfirmed and shown that way.

**Resolving a hypothesis is a new event.** `hypothesis_resolved` points at the hypothesis by id; the hypothesis itself is never edited or removed, so rejected ideas stay in the history with their reason. Resolving an unknown id is refused.

## The CLI

```bash
node process/cli.ts --help
node process/cli.ts record <kind> [options]
node process/cli.ts replay [--json] [--event <id>]
node process/cli.ts status [--json]
```

Recording findings (the agent runs these through its Bash tool; the `/devguide` skill in `.claude/skills/devguide/SKILL.md` tells it when, and the session context repeats the rules after a resume):

```bash
node process/cli.ts record observation --text "Only 100 of 250 rows land in the file" --files "src/export.ts" --material "sample=rows: 100"
node process/cli.ts record hypothesis --text "The loop stops after the first page"
node process/cli.ts record hypothesis_resolved --hypothesis 7794fb43 --outcome rejected --text "The page parameter is passed correctly"
node process/cli.ts record proposal --text "Fetch pages until the response is empty"
node process/cli.ts record change_prepared --text "Add a loop over pages" --files "src/export.ts" --patch-file /tmp/fix.diff
node process/cli.ts record change_explained --title "Fetch every page" --purpose "Export all rows, not only the first page" --mechanism "Loop over pages until the API returns an empty one" --assumptions "The API returns an empty page at the end" --files "src/export.ts" --material "example=3 pages of 100, 100, 50 rows -> 250 rows"
node process/cli.ts record decision --question "Apply fix A?" --quote "Tak, zastosuj poprawkę A" --reading "apply fix A"
node process/cli.ts record check --what "all 250 rows are exported" --expected "250 records written" --command "npm test" --evidence "250 records written" --claimed passed --limits "synthetic data, no filters"
```

`record` prints `recorded <kind> <id>` followed by what the log decided, so the agent sees at once when a claim did not hold: for a check `status=passed execution=<id>` or `status=unverified reason=<reason>: <what to do>`, for a decision `confirmed=true|false`, for an explanation `changes=<ids>` or `changes=none`. It exits with 1 when there is no open task, a required field is missing or an id is unknown; nothing is written then. Help and errors are in English, like the rest of the developer tooling; `replay` and `status` are in Polish, like the preview they precede.

Reading the task back:

```bash
DEVGUIDE_DIR=.devguide/experiment node process/cli.ts status
DEVGUIDE_DIR=.devguide/experiment node process/cli.ts replay
DEVGUIDE_DIR=.devguide/experiment node process/cli.ts replay --event 7f86f783
DEVGUIDE_DIR=.devguide/experiment node process/cli.ts replay --json
```

The first three lines above read the task left by `npm run experiment`. `status` prints the summary: the task, the number of events by origin, the current code version, hypotheses with their state (open, confirmed, rejected, with the reason), checks with their status, unconfirmed decisions and the files involved. `replay` prints the summary and then one line per event, oldest first: time, origin in brackets, one plain sentence, event id in parentheses. `--event <id>` prints every field of one event, including full command output and the before and after of a file change. `--json` returns `{ task, events, summary, model }`; `model` is the view model the [local preview](local-preview.md) renders (timeline items, fix cards, check results), so the preview's data can be inspected without a browser.

A check that passed on one code version and is followed by events on another is shown as "przeszło na wcześniejszej wersji kodu" rather than as confirmed: a later change may have invalidated it.

## Context for the agent at the start of a session

When a session starts or resumes while a task is open, the hook answers `SessionStart` with `additionalContext`: the task id and description, counts of events, hypotheses and checks, and the replay command. The experiment confirmed on Claude Code 2.1.300 that the agent receives it: in the resumed session it reported the task id, which only the hook knows.

## Cost

Measured with `npm run experiment` on 2026-10-21 (Windows 11, Node 24.20.0, Claude Code 2.1.300, model `sonnet`): the hook adds about 120 ms per tool call, counted from `PreToolUse` to `PostToolUse` minus the tool's own `duration_ms`, the same order as in stage 2 before the task log existed. The working-tree fingerprint (three or four `git` calls) runs only when a task event is created, so tool calls that read files cost nothing extra. The whole run (two sessions, eleven task events) cost 0.45 USD the first time and 0.24 USD on a rerun a few minutes later.

## Limits

- Changes made outside Claude Code tools (a manual edit by the user) are not recorded as events. The fingerprint still changes, so a check done before such an edit is shown as made on an earlier version.
- The match between a check and its execution is by exact command text. A check that quotes the command differently than it was run (an extra `cd`, different quoting) is recorded as `unverified` with `no_execution`; `--execution <id>` names the run explicitly.
- One task at a time. A new `/devguide` opens a new task without closing the old one explicitly; the old directory stays on disk.
- `tool_failed` keeps whatever `PostToolUseFailure` delivers; the payload shape has not been observed yet.
