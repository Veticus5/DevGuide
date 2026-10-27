# DevGuide

DevGuide is a toolset that lets a developer see and control what an AI coding agent does to their code: the problem being investigated, what is established versus assumed, the proposed fix, the changed code with examples, the decisions that need a human answer, and what was actually checked.

Status: early. The repository, stack and project checks are in place; the integration with Claude Code (hooks, a minimal `/devguide` skill, blocking a tool call, resuming a session) is confirmed by a repeatable experiment; a task event log records the course of a task: tool observations from the hooks, findings recorded by the agent through a CLI, with rules that keep "check passed" tied to a real run and a user decision tied to the user's words; a local preview (`npm run preview`) shows the task in the browser as it happens: the history of meaningful steps with each step's own view, the AI-changed code with before/after snippets and explanations, and the check results; and the `/devguide` skill guides the agent through investigating, planning, implementing, verifying and explaining, recording findings in the log as it goes. The user control point (approving a prepared fix before it is applied) is the next stage. See [docs/devguide-plan.md](docs/devguide-plan.md) for the product plan and stages, [docs/stack.md](docs/stack.md) for the stack and why it was chosen, [docs/claude-code-integration.md](docs/claude-code-integration.md) for what the integration can and cannot do, [docs/task-event-log.md](docs/task-event-log.md) for the event format and the CLI, and [docs/local-preview.md](docs/local-preview.md) for the preview.

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

`npm run check:test` also covers `ui/preview.js`, the only JavaScript file: its test imports it in Node and checks the HTML it renders.

The same command runs in GitHub Actions on every push to `main` and every pull request ([.github/workflows/ci.yml](.github/workflows/ci.yml)).

## Integration experiment

One more command checks the integration with Claude Code end to end. It is not part of `npm run check` because it needs a logged-in Claude Code and spends tokens:

```bash
npm run experiment
```

It runs two short `claude -p` sessions with the DevGuide hooks loaded, starts the preview server on the recorded task, then reports for each question of stages 2, 3 and 4 of the plan whether the logs, the disk and the preview data confirm it. Details and results: [docs/claude-code-integration.md](docs/claude-code-integration.md). To read the task the experiment recorded, in the terminal or in the browser:

```bash
DEVGUIDE_DIR=.devguide/experiment node process/cli.ts replay
DEVGUIDE_DIR=.devguide/experiment npm run preview
```

## Preview

While the agent works on a task started with `/devguide`, a local page shows what it observed, assumed, changed and checked:

```bash
npm run preview
```

It prints `http://localhost:4310`, follows the current task and updates after every new event. Options and what each view shows: [docs/local-preview.md](docs/local-preview.md).

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
- `process/` - local process: the task event log and its CLI, the server behind the preview.
- `ui/` - local preview page.
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
