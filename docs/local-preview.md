# Local preview

How to look at a DevGuide task while the agent works on it and after it is done. Stage 4 of the [plan](devguide-plan.md). The preview reads the [task event log](task-event-log.md) and shows it in three views in the browser; it adds nothing to the log and interprets nothing beyond what the log already states. The server is in [process/](../process/README.md), the page in [ui/](../ui/README.md).

## Running it

```bash
npm run preview
```

The command prints the address (default `http://localhost:4310`), the data directory and the task it shows, then runs until Ctrl+C. The page follows the current task of the data directory: `DEVGUIDE_DIR` when set, otherwise `.devguide/` in the current directory, the same place the Claude Code hook writes to. Without a task the page says so and switches to the first task started with `/devguide`.

| Option | Effect |
| --- | --- |
| `--port <n>` or `DEVGUIDE_PORT` | Another port. The flag wins over the variable. |
| `--task <id>` | Show one task and stay on it, even when a new task starts. |
| `DEVGUIDE_DIR=<dir>` | Another data directory, for example the one left by the experiment. |

To look at the task recorded by `npm run experiment`:

```bash
DEVGUIDE_DIR=.devguide/experiment npm run preview
```

The server listens on `127.0.0.1` only. A port already in use ends the command with a message that names `--port`.

## What the views show and where it comes from

Every piece of information on the page carries its origin, the same four as in the log: text the user typed, a result returned by a Claude Code tool, a finding the agent recorded, or DevGuide's own bookkeeping. Snippets, patches and command outputs are labelled "wynik narzędzia" and come only from tool events. Explanations, expectations and examples are labelled "AI" or "ilustracja od AI" and come only from the agent's findings. The page never turns one into the other.

The page starts with the task header: the repository and the task id, the title (the first sentence of the description), the full description when it says more, and one status line. The line keeps execution apart from verification. Execution comes from the last event only: "Agent pracuje", "Agent zakończył turę i czeka na odpowiedź" (the last event is the agent's message) or "Sesja zakończona" (the hook recorded the end of the session). Verification names the checks that exist, for example "2 sprawdzenia potwierdzają bieżący kod" or "1 sprawdzenie niepotwierdzone", or says "brak zapisanych sprawdzeń". A task is never described as still running because it has no checks. Categories with nothing in them are not mentioned, and a prepared fix waiting for a decision takes the whole line.

The tabs "Kod AI" and "Wyniki sprawdzeń" appear only when there is something to review there: a recorded code change or proposal, respectively at least one check. A task that has neither shows only "Przebieg".

**Przebieg** follows the product mockup: the history of the task's meaningful steps on the left, the selected step's own view on the right. On a narrow window the two stack, picking a step opens its view below the list and "← Kroki" scrolls back. The newest step is selected until the user picks one; a step picked by hand stays selected when new events arrive.

The history holds only meaningful events, each with a time, a short title and a one-line state: "Zgłoszono zadanie", an observation, a hypothesis ("Podejrzenie · odrzucone"), its resolution ("Odrzucono podejrzenie"), a proposal, "Przygotowano poprawkę", a code change with its explanation ("2 fragmenty kodu") or without one ("Zmieniono plik … · Bez objaśnienia od AI"), a check ("Sprawdzenie · przeszło"), a user decision. When the agent recorded findings, commands, tool failures, the agent's messages, the user's later prompts, session resumes and the session end are never steps of their own: each becomes a source of the next step in time (or of the last one), because that is what it led to.

A task in which the agent recorded no findings at all (for example one run before the guiding skill existed) gets short factual steps rebuilt from the tools instead: one per command, titled with the file the command names when one can be read from it ("Polecenie na src/export.ts", otherwise "Polecenie"), subtitled with the first line of its output ("wyjście: „greetings”", or "bez wyjścia"), and a view that shows the output and says that the agent did not record why it ran the command. The command text itself stays in the sources. As soon as the agent records its first finding, the commands that precede it fold into that finding's sources. The preview never invents a step, a purpose, a result or a reason that the log does not contain.

A step's view has a short line naming its kind and its relation to the code ("Zmiana w kodzie · 2 fragmenty · po poprawce", "Propozycja · pliki jeszcze bez zmian"), the title, one or two sentences of explanation, and only the concrete thing the step needs:

- an example the agent attached, captioned "Przykład od AI. Nie jest wynikiem sprawdzenia.";
- the fragments before and after a change, labelled as tool results, with a link to the matching card in "Kod AI", and the list "Sprawdzenia po tej zmianie": the checks whose execution happened after the change, with their status and a link to each, or the sentence that none was recorded (chronology, not a claim that the check covers the change);
- the mechanism and the assumptions of an explained change;
- the patch of a prepared fix;
- for a check: the status, the evidence (marked as found in the output, or as given by the agent and not found), the first lines of the output, the limits the agent stated, and the files changed since the execution when the result no longer covers the current code;
- the state of a hypothesis and the reason it was rejected or confirmed, with the rejected hypothesis kept in the history;
- the record of a decision: the question, the user's words, the agent's reading, whether the words back it;
- a sentence naming what is missing when the log lacks it, for example a check recorded without an execution.

Below the view, "Źródła" opens the events behind the step: time, origin, one-line description, the full command and its output, the agent's message (labelled as a statement, not a confirmation), the event id and the code version. Nothing in the main text requires reading a terminal command.

The decision buttons "Zatwierdź i zastosuj lokalnie" and "Odeślij do poprawy" appear only in the view of a prepared fix that no tool has applied. Until stage 6 wires the control point, they are disabled and captioned as a demonstration; they change nothing in the log or the repository.

**Kod AI** shows one card per logical fix. A card exists only when the agent recorded an explanation (`change_explained`); the card then shows the file changes the explanation covers as the tool recorded them: the path, the line range from the patch, the fragment "przed poprawką" and "po poprawce", and under "Szczegóły wersji" the commit and fingerprint of each change. Below the changes the card shows the agent's purpose, mechanism, example and assumptions, each labelled as coming from AI. Three other things can appear in the view:

- "Zmiany bez objaśnienia od AI": file changes recorded by a tool that no explanation covers. They are shown with their before/after and no interpretation, so a change never disappears because nobody explained it.
- "Propozycje": a change the agent prepared (`change_prepared`) but that no tool applied; it is marked "niezastosowana". The preview does not try to match a proposal with later file changes; stage 6 adds approval of a specific proposal and will make that link.
- "Pełny diff": every recorded patch, grouped by file, in order of recording, in unified format. A created file is shown with all its lines added. When a tool returned no hunks for a change, the diff shows the before and after blocks with a note that the patch was unavailable.

An explanation that matches no recorded change is still shown as a card, with the notice that there is no recorded file change for it and no fragment presented as "after".

**Wyniki sprawdzeń** shows each check with what it checked, the expectation, the command, the evidence quoted from the output, the status and the limits the agent stated. The full output of the execution opens on demand and is labelled as a tool result. Checks are split into those confirmed by an execution (passed, failed, inconclusive) and those recorded as unverified, which carry the reason (no execution, no evidence, evidence not found in the output) and show the agent's claim only as a claim. A check whose execution happened on an earlier code version than the latest event is marked "przeszło na wcześniejszej wersji kodu" with the files changed since, and the header does not count it as confirming the current code. Plain commands that no check refers to are not shown here: a check needs a subject, an expectation and an observed result, and `echo done` confirms only that text was printed. Those commands stay in the sources of the steps in "Przebieg".

The header above the tabs says in plain words how many hypotheses are open, confirmed and rejected, how many checks confirm the current code or are unverified, and how many decisions lack a quote from the user.

## How the page stays current

The server polls the size and modification time of `current-task` and of the shown task's `events.jsonl` every 500 ms. When either changes it sends an `update` over a Server-Sent Events stream, and the page fetches the data again and repaints. Open details and the chosen tab survive the repaint. When the server is restarted while the page is open, the browser reconnects on its own and the server sends an update on every new connection, so the page catches up without a reload.

## Data for other tools

| Path | Content |
| --- | --- |
| `GET /api/preview` | `{ task, repo, events, summary, model, version, pinned }`, or `{ task: null, repo, data_dir }` without a task. `model` is the view model: the header with the status line, the steps with their blocks and sources, fix cards, check results with their state, and the flat timeline for other tools. |
| `GET /api/updates` | SSE stream: `update` with `{ task_id, version }` on every detected change and once on connect; `ping` every 15 s. |
| `GET /` and `GET /ui/<file>` | The page and its two files. Nothing else is served. |

`node process/cli.ts replay --json` returns the same `model` for the open task, so the data can be inspected without the server. The experiment (`npm run experiment`) starts the server on a free port, fetches `/api/preview` and checks that the fix card for `hello.txt` carries the tool's before/after and the agent's explanation; see [claude-code-integration.md](claude-code-integration.md).

## Limits

- Up to about one second passes between a write to the log and the repaint.
- One task per window. Another task needs `--task` or another data directory; there is no task list in the page.
- Changes made outside Claude Code tools are not events, so they appear only indirectly: the working-tree fingerprint changes and later checks are marked as made on an earlier version, with "kod poza narzędziami Claude Code" as what changed.
- A file written or edited through a Bash command (`sed`, `printf`, a redirect) is a `command_run`, not a `file_changed`: the step shows the command's output, not a before/after fragment, and "Kod AI" has no card for it. Only the `Write` and `Edit` tools produce file changes the preview can show as code. The guiding skill of stage 5 is expected to ask the agent to use those tools for code changes.
- Steps and cards depend on the agent recording findings. Until the guiding skill of stage 5 asks for them, a task run without that instruction shows only "Zgłoszono zadanie" and the code changes, with everything else in the sources.
- The decision buttons are a demonstration until stage 6.
- A proposal is never matched with the file changes that may have applied it; that is stage 6.
- The page is plain HTML, CSS and JavaScript without a build step. Its rendering is tested in Node on the HTML it produces; layout and behaviour in a browser are checked by hand.
