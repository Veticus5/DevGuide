# Claude Code integration

What DevGuide can rely on in its integration with Claude Code, confirmed by running code rather than by reading documentation. This file answers the five questions of stage 2 of the [plan](devguide-plan.md) and records the limits found on the way. Later stages build on this file.

Confirmed with:

| | |
| --- | --- |
| Command | `npm run experiment` ([agent/experiment/run.ts](../agent/experiment/run.ts)) |
| Date | 2026-10-21 |
| Claude Code | 2.1.300, native Windows build |
| System | Windows 11 (win32 x64), Node 24.20.0, run from Git Bash |
| Model in the test sessions | `sonnet` (the mechanisms do not depend on the model) |
| Cost of one run | about 0.19 USD (two sessions), 15 log entries, 14 s wall clock |

Rerun the experiment after upgrading Claude Code. It exits with 0 only when every question below is still confirmed.

## The five questions

| Question from the plan | Answer | Evidence in the run | Limits |
| --- | --- | --- | --- |
| How to start the guiding skill | `/devguide <task>` typed by the user. The skill is [.claude/skills/devguide/SKILL.md](../.claude/skills/devguide/SKILL.md) with `disable-model-invocation: true`, so only the user starts it. | The first assistant message of session 1 was exactly the confirmation sentence defined only in the skill. The `UserPromptSubmit` hook received the raw text `/devguide Integration experiment, ...` and the log marked it `task_started`. An ordinary prompt mentioning DevGuide produced no such entry. | The `result` field of `claude -p --output-format json` holds only the final message. The skill therefore repeats the confirmation at the start of its final report; the first run of the experiment, before that change, reported "nie" for this question although the transcript showed the sentence as the first message. |
| How to receive information about what the agent did | Hooks. One script ([agent/hooks/record-event.ts](../agent/hooks/record-event.ts)) configured for `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `Stop`, `SessionEnd` receives JSON on stdin and appends a line to the log. | Session 1 produced `SessionStart` (`source: startup`), `PreToolUse` and `PostToolUse` for `Write`, `Edit` and `Bash`, `Stop` with `last_assistant_message`, `SessionEnd` (`reason: other`), all with the same `session_id` as the result JSON. | Hooks run per tool call, not per "operation" in the user's sense. Each hook starts a Node process plus `git rev-parse`; about 100 ms per event in this run. `PostToolUseFailure` did not fire because nothing failed; its payload shape is untested. |
| How to record file changes and command results | From `PostToolUse`: `tool_input` holds what the agent asked for, `tool_response` what the tool returned. No agent narration is involved. Each entry also carries the current commit. | `Write` returned `filePath`, `type: create`, `content`; `Edit` returned `oldString`, `newString`, `originalFile` and a unified `structuredPatch`; `Bash` returned `stdout: "devguide-ok"`, `stderr`, `interrupted`. The file on disk matched. | `Bash` `tool_response` has no exit code field. A non-zero exit is expected to surface as `PostToolUseFailure` or in `stderr`, which this run did not exercise. Shapes are undocumented for `Edit` and may change between versions; see the next section. |
| Whether a specific operation can be stopped before it runs | Yes. A `PreToolUse` hook that prints `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"..."}}` stops the call. The agent receives the reason. | The command `echo devguide-block-me > .../blocked.txt` was matched by the allow-rule `Bash(echo *)`, so only the hook could stop it. `blocked.txt` does not exist, the log has one `PreToolUse` entry with `kind: blocked` and the full command, there is no `PostToolUse` for it, and the result JSON lists it under `permission_denials`. The agent's report also said it was refused, but the verdict does not use that statement. | The block is per tool call and only as good as the condition in the hook: the marker is artificial. A `Write` with the same text is not blocked, by design. Nothing stops the agent from achieving the same effect another way unless that way is also matched. If the hook script crashes or times out, the call proceeds unless `onFailure: "block"` is configured, which was not tested. |
| How to resume a task after the session is interrupted | `claude -p --resume <session_id>` (or `claude --resume <id>` interactively). Setting `--session-id <uuid>` up front makes the id known before the first session ends. | Session 2 produced `SessionStart` with `source: resume` and the same `session_id`, and answered with the code word given only in session 1. | Resume restores the conversation, not the working tree. Sessions created with `-p` are hidden from the interactive `/resume` picker but resume by id. The transcript format in `~/.claude/projects/` is internal. |

## Shapes observed in hook input

Common to every event: `session_id`, `transcript_path`, `cwd`, `scratchpad_dir`, `hook_event_name`, `permission_mode`, `prompt_id` (absent on `SessionStart`), `effort`.

| Event | Extra fields seen |
| --- | --- |
| `SessionStart` | `source` (`startup`, `resume`); on resume also `seconds_since_last_response`, `context_tokens`, `prompt_cache_likely_expired`, `estimated_cache_write_usd`. |
| `UserPromptSubmit` | `prompt` with the raw text the user typed, including a leading `/devguide`. |
| `PreToolUse` | `tool_name`, `tool_input`, `tool_use_id`. |
| `PostToolUse` | `tool_name`, `tool_input`, `tool_response`, `tool_use_id`, `duration_ms`. |
| `Stop` | `last_assistant_message`, `stop_hook_active`, `background_tasks`, `session_crons`. |
| `SessionEnd` | `reason` (`other` in print mode). |

`tool_response` per tool:

| Tool | Keys |
| --- | --- |
| `Write` | `type` (`create`), `filePath`, `content`, `structuredPatch` (empty for a new file), `originalFile` (`null` for a new file), `userModified`. |
| `Edit` | `filePath`, `oldString`, `newString`, `originalFile`, `structuredPatch` (hunks with `oldStart`, `oldLines`, `newStart`, `newLines`, `lines`), `userModified`, `replaceAll`. |
| `Bash` | `stdout`, `stderr`, `interrupted`, `isImage`, `noOutputExpected`. No exit code. |

## Other facts the experiment established

- Hooks passed with `claude --settings <file>` are merged and run in `-p` mode. DevGuide keeps its hooks in [agent/experiment/settings.json](../agent/experiment/settings.json) and loads them only for the experiment, so ordinary sessions in this repository do not run them.
- The exec form `{"type":"command","command":"node","args":["agent/hooks/record-event.ts"]}` with a path relative to the session's working directory works on Windows from Git Bash. The `${CLAUDE_PROJECT_DIR}` placeholder was not needed and its expansion inside `args` remains untested.
- In `-p` mode in an untrusted workspace Claude Code ignores `permissions.allow` from the project settings and says so on stderr. `--allowedTools` on the command line still applies. `--permission-mode acceptEdits` plus `--permission-prompts none` ran the experiment without any prompt.
- The result JSON of `-p` contains `session_id`, `result`, `total_cost_usd`, `duration_ms`, `num_turns`, `permission_denials` and `modelUsage`.
- The activity log line written by the hook has the fields `time`, `session_id`, `event`, `source` (`hook`, or `agent` for `Stop`), `code_version` (commit or `null`), `cwd`, optional `kind` (`task_started`, `blocked`) and `payload` with the rest of the hook input unchanged.

## Consequences for the next stages

- Stage 3 (event log) can take tool observations straight from `PostToolUse`: paths and patches for file changes, `stdout` and `stderr` for commands. It must treat the absence of an exit code as a fact: "the command ran" is known, "the command succeeded" needs a separate check.
- Stage 5 (guiding skill) can rely on `/devguide` as the single entry point and on `UserPromptSubmit` to mark the start without the agent's cooperation. Structured findings from the skill still need a channel of their own; a hook cannot see the agent's reasoning, only `last_assistant_message` at the end of a turn.
- Stage 6 (control point) can enforce "do not apply before approval" with a `PreToolUse` deny on `Write`, `Edit` and file-writing `Bash` calls, as long as the condition is expressed over `tool_input`. The rule must be fail-closed (`onFailure: "block"`) and that needs its own test.
- Resuming after an interruption is Claude Code's job; DevGuide only has to record the session id and recognise `source: resume`.

## Not confirmed

- Hook behaviour on Windows without Git Bash (PowerShell shell) and on Linux. CI runs only the unit tests of the hook script.
- Interactive sessions. Every observation above comes from `-p` mode; hooks are the same mechanism, but the permission flow differs.
- `PostToolUseFailure` payload, `Stop` blocking, `onFailure: "block"`, `updatedInput`, `SessionStart` `additionalContext`.
- Behaviour when the hook is slow: default timeout for command hooks is 600 s per the documentation, `SessionEnd` has 1.5 s by default (raised to 10 s in the experiment settings).
- An npm-installed `claude` (a `.cmd` shim); the runner spawns `claude` without a shell and reports Claude Code as unavailable if that fails.
