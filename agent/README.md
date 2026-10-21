# agent

Integration with Claude Code: hooks that record what the agent did, the `/devguide` skill that starts a task, and later the control point where the user approves a prepared fix. Stage 2 of the [plan](../docs/devguide-plan.md) is done: the integration experiment confirmed the mechanisms, and the findings are in [docs/claude-code-integration.md](../docs/claude-code-integration.md). Stages 5 and 6 fill in the guiding skill and the control point.

## What is here

- `hooks/record-event.ts` - one hook script for every Claude Code hook event. It appends a JSON line per event to the raw activity log (`events.jsonl` in `DEVGUIDE_DIR`, default `.devguide/` in the working directory), hands the event to the task log in `process/` (a `/devguide` prompt opens a task; file changes, commands, prompts and the agent's end-of-turn message become task events), answers `SessionStart` with the task context when a task is open, and refuses a Bash command that contains `devguide-block-me`. Tests in `hooks/record-event.test.ts` run the script as a child process and are part of `npm run check`.
- `experiment/settings.json` - the hook configuration, loaded only for the experiment with `claude --settings agent/experiment/settings.json`. Day-to-day sessions in this repository do not run the hooks.
- `experiment/run.ts` and `experiment/evaluate.ts` - the integration experiment: two `claude -p` sessions (the second resumed with `--resume`), then a verdict per question based on the raw log, the task log and the disk: the five questions of stage 2 and three about the task log of stage 3. Tests of the verdict rules are in `experiment/run.test.ts`.
- The `/devguide` skill lives in [.claude/skills/devguide/SKILL.md](../.claude/skills/devguide/SKILL.md), because Claude Code only discovers skills there.

## Running the experiment

```bash
npm run experiment
```

Requires an installed and logged-in Claude Code and spends tokens (0.25 to 0.45 USD per run with the default `sonnet` model; set `DEVGUIDE_EXPERIMENT_MODEL` to use another). It writes the raw log, the task log, both session results and the report to `.devguide/experiment/` and exits with 0 only when all eight questions are confirmed. Rerun it after upgrading Claude Code. Afterwards `DEVGUIDE_DIR=.devguide/experiment node process/cli.ts replay` shows the recorded task.
