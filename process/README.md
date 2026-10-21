# process

Local process behind DevGuide: the task event log (stage 3 of the [plan](../docs/devguide-plan.md), done) and later the server behind the preview (stage 4). The format, the rules and the CLI are described in [docs/task-event-log.md](../docs/task-event-log.md).

## What is here

- `events.ts` - the event model: envelope, kinds, origins, validation of drafts.
- `paths.ts` - where the data lives: `DEVGUIDE_DIR` or `.devguide/`, raw log, task directories.
- `code-version.ts` - commit plus working-tree fingerprint, so uncommitted changes count as a different code version.
- `task-log.ts` - starting a task, appending events, turning hook inputs into tool events (`recordHookEvent`) and recording the agent's findings with the rules for checks, decisions and hypothesis resolutions (`appendAgentEvent`).
- `replay.ts` - reading a task back: summary of hypotheses, checks and decisions, timeline in plain language, details of one event, context for the agent at session start.
- `cli.ts` - `node process/cli.ts record|replay|status`. The agent records findings with it; people read the task with it.

Tests sit next to each file as `*.test.ts` and run with `npm run check`. Nothing here imports from `agent/`; the hook in `agent/hooks/` imports from here.

## Reading a task

```bash
node process/cli.ts status            # summary of the open task in ./.devguide
node process/cli.ts replay            # summary plus one line per event
node process/cli.ts replay --json     # the same as data
DEVGUIDE_DIR=.devguide/experiment node process/cli.ts replay   # the task left by npm run experiment
```
