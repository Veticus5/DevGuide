# Stack

DevGuide runs on Node.js 24 LTS with TypeScript executed directly by Node, without a build step. Type checking is a separate command and never part of running the code. Tests use the runner built into Node. One `package.json` at the repository root covers every part of the project.

The choice follows the plan's instruction to pick the simplest stack that works. Node is already required by the OpenSpec CLI, so it adds no new runtime. Claude Code hooks are plain processes that read JSON from stdin and answer with an exit code or JSON on stdout, so a script that starts in milliseconds is enough. The preview lives in a browser, which needs JavaScript anyway. Running `.ts` files directly removes the whole class of "built output differs from source" problems and keeps the loop at edit, run, look.

The first version serves one user, one task, one repository and Claude Code. Nothing here needs to scale, authenticate or deploy, so the stack avoids everything that exists for those reasons.

## Decisions

| What | Why | Alternative considered |
| --- | --- | --- |
| Node.js 24 LTS | Current LTS, runs `.ts` files natively, already required by OpenSpec. | Node 22.18+ also works; chosen 24 to avoid a flag-era edge case. |
| TypeScript without a build step | Types for the event format, which is the core of the project, with zero transpile step. `tsc --noEmit` only checks. | Plain JavaScript: fewer tools, but the event format would have no types. A bundler (tsx, esbuild, Vite): a step Node no longer needs. |
| Tests in `node:test` | Built in, understands `.ts`, reports enough. | Vitest or Jest: can be added later without moving files. |
| One root `package.json` | The project directories have no dependencies of their own yet. | npm workspaces: more structure than the code justifies; revisit when `demo/` needs to look like a foreign repository. |
| Own Markdown link checker (`scripts/check-links.ts`) | Only relative links matter and no network access is wanted; the script is smaller than any dependency. | `markdown-link-check`, `lychee`: external dependency, network checks by default. |
| GitHub Actions, one job | Checks take seconds; one job on Linux is enough until OS-specific code appears. | OS matrix: add when hooks (stage 2) introduce platform-specific behaviour. |

## Rules that follow from the stack

- Only TypeScript syntax that Node can strip is allowed: no `enum`, no parameter properties, no `namespace`. `erasableSyntaxOnly` in [tsconfig.json](../tsconfig.json) turns a violation into a type error.
- Imports between `.ts` files use the `.ts` extension, as Node requires.
- Test files sit next to the code as `*.test.ts`.
- `npm run check` runs every project check and must pass before a change is finished. See the [README](../README.md) for the individual commands.
