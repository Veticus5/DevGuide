# DevGuide

Developer guide maintained as a documentation repository. Content lives in Markdown.

> TODO: replace this paragraph with one or two sentences on what the guide covers and who it is for.

## Repository layout

- `README.md` - entry point for human readers.
- `docs/` - guide content, one topic per file (create when adding the first page).
- `.claude/` - Claude Code project configuration (settings, skills, commands).

## Writing conventions

- Language of the content: English (change here if the guide should be in Polish).
- One H1 per file, matching the file name. Use sentence case for headings.
- Prefer short sections and numbered steps over long prose.
- Code, commands and config go in fenced blocks with a language tag.
- Link between pages with relative paths, for example `[Setup](docs/setup.md)`.
- File names: lowercase, words separated with hyphens, `.md` extension.

## Working with Claude Code in this repo

- Before writing a new page, check `docs/` for an existing page on the topic and extend it instead of duplicating.
- Keep edits scoped to what was asked. Do not reformat unrelated files.
- Do not commit or push unless asked. When asked, write commit messages in the imperative mood, under 72 characters on the first line.
- Never push with `--force` to `main`.
- This repository is public on GitHub. Do not add secrets, internal URLs, customer data or personal data to any file.

## Verification

There is no build or test step yet. Before finishing a change, confirm that:

- every relative link points at a file that exists,
- Markdown renders (no unclosed code fences, consistent list markers).
