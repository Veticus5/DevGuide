# DevGuide

A developer guide kept as plain Markdown.

> TODO: describe the scope of the guide and its intended readers.

## Contents

Pages live in `docs/`. Add the first page and list it here.

## Contributing

1. Create a branch from `main`.
2. Add or edit pages under `docs/`. Follow the conventions in [CLAUDE.md](CLAUDE.md).
3. Open a pull request.

## Working with Claude Code

This repository is set up for [Claude Code](https://claude.com/claude-code):

- `CLAUDE.md` holds the project instructions Claude reads at the start of every session.
- `.claude/settings.json` holds shared permissions. Personal overrides go in `.claude/settings.local.json`, which is git-ignored.

Open a terminal in the repository root and run `claude`.
