# DevGuide

DevGuide is a toolset that helps a developer understand and control the work an AI coding agent (Claude Code) does on their code. The full product plan, principles and stages are in [docs/devguide-plan.md](docs/devguide-plan.md). Read it before planning any change.

Current state: repository scaffold (stack, project directories, checks) and a confirmed integration with Claude Code: hooks that record tool events to a local log, a `PreToolUse` block, a minimal `/devguide` skill and session resume, all exercised by `npm run experiment`. What was confirmed, how, and the known limits are in [docs/claude-code-integration.md](docs/claude-code-integration.md); base later stages on that file, not on the mockups. No event log format or preview exists yet. Do not assume any capability works until it is implemented and checked in this repository.

## How work is organised

Features are added one at a time with [OpenSpec](https://github.com/Fission-AI/OpenSpec). Every change goes through a spec-driven cycle:

1. `/opsx:propose <name>` (or `/opsx:new` + `/opsx:continue` for one artifact at a time) creates `openspec/changes/<name>/` with `proposal.md`, `specs/`, `design.md` and `tasks.md`.
2. The user reviews the artifacts.
3. `/opsx:apply` implements the tasks. Planning and implementing never happen in the same request.
4. `/opsx:verify` checks the implementation against the artifacts.
5. `/opsx:archive` moves the change to `openspec/changes/archive/` and merges its deltas into `openspec/specs/`.

Rules for the agent:

- Do not edit project code outside an OpenSpec change unless the user explicitly asks for a one-off fix.
- Map every change to a stage of the plan and keep it to one working, checkable increment.
- `openspec/config.yaml` holds project context and artifact rules. Keep it in sync with the plan when the plan changes.
- OpenSpec artifacts are written in Polish (set in `openspec/config.yaml`). Code, comments, commit messages and this file are in English.

## Repository layout

- `agent/` - integration with Claude Code: `hooks/` (the hook script and its tests), `experiment/` (hook settings for the experiment, the experiment runner), later the user control point (stages 2, 5, 6). The `/devguide` skill itself is in `.claude/skills/devguide/`.
- `process/` - local process: event log and the server behind the preview (stages 3, 4).
- `ui/` - local preview (stage 4).
- `demo/` - demonstration project with a real bug for the end-to-end example (stage 7).
- `scripts/` - project checks and helper scripts (`check-links.ts`).
- `docs/` - plan and project documentation (`docs/devguide-plan.md` is the source of truth for scope, `docs/stack.md` explains the stack).
- `openspec/` - specs (`specs/`), active and archived changes (`changes/`), project context (`config.yaml`).
- `.claude/` - Claude Code configuration: shared permissions, OpenSpec commands (`commands/opsx/`) and skills (`skills/openspec-*`), plus the project's own `skills/devguide/`. Regenerate the OpenSpec files with `openspec update`, do not edit them by hand.
- `.github/workflows/ci.yml` - CI, runs `npm run check`.
- `README.md` - entry point for human readers.

## Stack

Node.js 24 and TypeScript run directly by Node, no build step. Tests use `node:test` in `*.test.ts` files next to the code. One root `package.json`. Rationale and alternatives: [docs/stack.md](docs/stack.md).

- Only TypeScript syntax that Node can strip: no `enum`, parameter properties or `namespace` (`erasableSyntaxOnly` enforces it).
- Import other `.ts` files with the `.ts` extension.
- No new dependency without a sentence in the change's design explaining why the built-in alternative is not enough.

## Conventions

- Markdown: one H1 per file matching the file name, sentence-case headings, short sections, fenced blocks with a language tag, relative links.
- File names: lowercase, hyphen-separated.
- Keep edits scoped to what was asked. Do not reformat unrelated files.
- Do not commit or push unless asked. Commit messages: imperative mood, first line under 72 characters.
- Never push with `--force` to `main`.
- This repository is public on GitHub. No secrets, internal URLs, customer data or personal data in any file.

## Verification

Before finishing a change confirm that:

- `npm run check` passes (types, tests, relative links in Markdown, `openspec validate --all`),
- Markdown renders (closed code fences, consistent list markers),
- any check the change's `tasks.md` names was actually run, with its output reported,
- a change that touches the Claude Code integration (`agent/`, `.claude/skills/devguide/`) was exercised with `npm run experiment`, which needs a logged-in Claude Code and spends tokens.
