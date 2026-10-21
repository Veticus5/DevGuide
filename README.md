# DevGuide

DevGuide is a toolset that lets a developer see and control what an AI coding agent does to their code: the problem being investigated, what is established versus assumed, the proposed fix, the changed code with examples, the decisions that need a human answer, and what was actually checked.

Status: early. The repository, stack and project checks are in place; the integration with Claude Code (hooks, a minimal `/devguide` skill, blocking a tool call, resuming a session) is confirmed by a repeatable experiment; and a task event log records the course of a task: tool observations from the hooks, findings recorded by the agent through a CLI, with rules that keep "check passed" tied to a real run and a user decision tied to the user's words. There is no preview yet. See [docs/devguide-plan.md](docs/devguide-plan.md) for the product plan and stages, [docs/stack.md](docs/stack.md) for the stack and why it was chosen, [docs/claude-code-integration.md](docs/claude-code-integration.md) for what the integration can and cannot do, and [docs/task-event-log.md](docs/task-event-log.md) for the event format and the CLI.

## Prerequisites

- Node.js 24 (the version in [.nvmrc](.nvmrc)).
- [Claude Code](https://claude.com/claude-code).

Install the development dependencies, which include the [OpenSpec](https://github.com/Fission-AI/OpenSpec) CLI:

```bash
npm install
```

A global `npm install -g @fission-ai/openspec@latest` is optional and only saves typing `npx` in front of `openspec`.

## Checks

One command runs every project check and fails on the first problem:

```bash
npm run check
```

Each check can also run on its own:

| Command | What it checks |
| --- | --- |
| `npm run check:types` | TypeScript types (`tsc --noEmit`). |
| `npm run check:test` | Tests in `*.test.ts` files with the Node test runner. |
| `npm run check:links` | Relative links in Markdown files point at existing files. |
| `npm run check:specs` | OpenSpec changes and specs are valid. |

The same command runs in GitHub Actions on every push to `main` and every pull request ([.github/workflows/ci.yml](.github/workflows/ci.yml)).

## Integration experiment

One more command checks the integration with Claude Code end to end. It is not part of `npm run check` because it needs a logged-in Claude Code and spends tokens:

```bash
npm run experiment
```

It runs two short `claude -p` sessions with the DevGuide hooks loaded, then reports for each question of stages 2 and 3 of the plan whether the logs and the disk confirm it. Details and results: [docs/claude-code-integration.md](docs/claude-code-integration.md). To read the task the experiment recorded:

```bash
DEVGUIDE_DIR=.devguide/experiment node process/cli.ts replay
```

## Working on the project

Every feature is an OpenSpec change. Open Claude Code in the repository root and use the `/opsx:*` commands:

| Command | What it does |
| --- | --- |
| `/opsx:explore` | Think through a problem before committing to a change. |
| `/opsx:propose <name>` | Create a change with proposal, spec deltas, design and tasks in one go. |
| `/opsx:new <name>` then `/opsx:continue` | Same, but one artifact at a time. |
| `/opsx:apply` | Implement the tasks of a change. |
| `/opsx:verify` | Check the implementation against the change artifacts. |
| `/opsx:archive` | Finish the change and merge its spec deltas into `openspec/specs/`. |

Artifacts live in `openspec/changes/<name>/`. Finished changes move to `openspec/changes/archive/`.

Useful CLI commands:

```bash
openspec list            # active changes
openspec status --change <name>
openspec validate
openspec update          # refresh .claude/ commands after upgrading OpenSpec
```

## Repository layout

- `agent/` - integration with Claude Code: hooks, the guiding skill, the user control point.
- `process/` - local process: the task event log and its CLI, later the server behind the preview.
- `ui/` - local preview.
- `demo/` - demonstration project with a real bug, used for the end-to-end example.
- `scripts/` - project checks and helper scripts.
- `docs/` - plan and documentation.
- `openspec/` - specs, changes and project context for OpenSpec.
- `.claude/` - Claude Code settings, OpenSpec commands and skills.
- `.github/` - CI workflow.

Each project directory has a README that says what it is for and which stage of the plan fills it.

Agent instructions are in [CLAUDE.md](CLAUDE.md).

## Contributing

1. Create a branch from `main`.
2. Add a change with OpenSpec, implement, verify, archive.
3. Open a pull request.
