# ui

The local preview page: the task timeline, the AI-changed code with before/after snippets and explanations, and the check results with their limits. Stage 4 of the [plan](../docs/devguide-plan.md). How to run it and what each view shows: [docs/local-preview.md](../docs/local-preview.md). The server that serves these files and the data is `process/server.ts`.

## What is here

- `index.html` - the page shell; everything inside `<main>` is rendered by the script.
- `preview.css` - dark theme, one accent colour, lists with separators, details on demand.
- `preview.js` - pure functions that turn the server's JSON into HTML strings (`renderPage`, `renderHistory`, `renderStepView`, `renderCode`, `renderChecks`), plus the browser part that fetches `/api/preview`, listens on `/api/updates`, follows the `#przebieg/<step>` hash and repaints while keeping the chosen tab, the chosen step and the open details. Plain JavaScript, because the browser does not run TypeScript and the project has no build step; it is the only `.js` file in the project.
- `preview.test.ts` - imports `preview.js` in Node and checks the HTML it produces: one history entry per meaningful step, the step view of a check, a change and a prepared fix, no commands, ids or raw agent messages outside the collapsed sources, demonstration buttons only for a prepared fix, escaping of event text. Layout and behaviour in a real browser are a manual check.

Nothing here reads the task log directly; the view model comes from `process/preview-model.ts` through the server.
