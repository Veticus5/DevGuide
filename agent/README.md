# agent

Integration with Claude Code: hooks that record what the agent did, the `/devguide` skill that starts a task, and later the control point where the user approves a prepared fix. Stage 2 of the [plan](../docs/devguide-plan.md) is done: the integration experiment confirmed the mechanisms, and the findings are in [docs/claude-code-integration.md](../docs/claude-code-integration.md). Stages 5 and 6 fill in the guiding skill and the control point.

## What is here

- `hooks/record-event.ts` - one hook script for every Claude Code hook event. It appends a JSON line per event to the activity log (`.devguide/events.jsonl` in the working directory, or the file named by `DEVGUIDE_LOG_FILE`) and refuses a Bash command that contains `devguide-block-me`. Tests in `hooks/record-event.test.ts` run the script as a child process and are part of `npm run check`.
- `experiment/settings.json` - the hook configuration, loaded only for the experiment with `claude --settings agent/experiment/settings.json`. Day-to-day sessions in this repository do not run the hooks.
- `experiment/run.ts` and `experiment/evaluate.ts` - the stage 2 experiment: two `claude -p` sessions (the second resumed with `--resume`), then a verdict per question of the plan based on the log and the disk. Tests of the verdict rules are in `experiment/run.test.ts`.
- The `/devguide` skill lives in [.claude/skills/devguide/SKILL.md](../.claude/skills/devguide/SKILL.md), because Claude Code only discovers skills there.

## Running the experiment

```bash
npm run experiment
```

Requires an installed and logged-in Claude Code and spends tokens (about 0.2 USD per run with the default `sonnet` model; set `DEVGUIDE_EXPERIMENT_MODEL` to use another). It writes the log, both session results and the report to `.devguide/experiment/` and exits with 0 only when all five questions are confirmed. Rerun it after upgrading Claude Code.
