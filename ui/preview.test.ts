// Renders the page module in Node, without a DOM: the functions return HTML
// strings, so the labels and the structure the specs require can be checked
// here. Layout and behaviour in a real browser stay a manual check.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CodeVersion, TaskEvent } from "../process/events.ts";
import { buildPreviewModel } from "../process/preview-model.ts";
import type { TaskRecord } from "../process/task-log.ts";
// @ts-ignore plain JavaScript on purpose: the browser runs it as is (see design D5)
import { checksSummary, escapeHtml, parseHash, plural, renderChecks, renderCode, renderHistory, renderPage, renderStepView, selectedStep, visibleViews } from "./preview.js";

const TASK: TaskRecord = { id: "20261021-1000-ab12", description: "Export fetches only page one", started: "2026-10-21T10:00:00.000Z", session_ids: ["s1"] };
const V1: CodeVersion = { commit: "c".repeat(40), working_tree: "1".repeat(64) };
const V2: CodeVersion = { commit: "c".repeat(40), working_tree: "2".repeat(64) };

let counter = 0;
type Base = { id: string; time: string; task_id: string; session_id: string | null; code_version: CodeVersion; files: string[] };
function event<K extends TaskEvent["kind"]>(kind: K, fields: Omit<Extract<TaskEvent, { kind: K }>, keyof Base | "kind"> & Partial<Base>): Extract<TaskEvent, { kind: K }> {
  counter += 1;
  const base: Base = { id: `ev${String(counter).padStart(6, "0")}`, time: `2026-10-21T10:${String(counter).padStart(2, "0")}:00.000Z`, task_id: TASK.id, session_id: "s1", code_version: V1, files: [] };
  return { kind, ...base, ...fields } as unknown as Extract<TaskEvent, { kind: K }>;
}

const HUNK = { oldStart: 3, oldLines: 1, newStart: 3, newLines: 1, lines: ["-page = 1", "+loop over pages"] };

/** A task with every kind of step, in a realistic order. */
function course(): TaskEvent[] {
  const started = event("task_started", { origin: "user", description: TASK.description });
  const probe = event("command_run", { origin: "tool", command: "npm run export -- --dry", stdout: "100 rows\n", stderr: "", interrupted: false, exit_code: null });
  const observation = event("observation", { origin: "agent", text: "Only 100 of 250 rows <script>alert(1)</script>", materials: [{ label: "sample", content: "rows: 100", nature: "illustration" }] });
  const hypothesis = event("hypothesis", { origin: "agent", text: "the page parameter is ignored" });
  const rejected = event("hypothesis_resolved", { origin: "agent", hypothesis_id: hypothesis.id, outcome: "rejected", text: "the parameter is passed" });
  const prepared = event("change_prepared", { origin: "agent", text: "Loop over pages", patch: "--- a\n+++ b\n-page = 1\n+loop\n", materials: [], files: ["src/export.ts"] });
  const run = event("command_run", { origin: "tool", command: "npm test", stdout: "250 records written\n", stderr: "", interrupted: false, exit_code: null });
  const passed = event("check", { origin: "agent", what: "all rows exported", expected: "250", command: "npm test", evidence: "250 records written", claimed: "passed", status: "passed", execution_id: run.id, reason: null, limits: "synthetic data" });
  const change = event("file_changed", { origin: "tool", path: "src/export.ts", created: false, before: "page = 1", after: "loop over pages", patch: [HUNK], tool: "Edit", files: ["src/export.ts"], code_version: V2 });
  const explained = event("change_explained", { origin: "agent", title: "Fetch every page", purpose: "export all rows", mechanism: "loop until empty", assumptions: "", materials: [{ label: "example", content: "3 pages -> 250 rows", nature: "illustration" }], change_ids: [change.id], files: ["src/export.ts"], code_version: V2 });
  const loose = event("file_changed", { origin: "tool", path: "src/loose.ts", created: true, before: null, after: "new\n", patch: [], tool: "Write", files: ["src/loose.ts"], code_version: V2 });
  const unverified = event("check", { origin: "agent", what: "filters apply", expected: "x", command: "npm run filters", evidence: "ok", claimed: "passed", status: "unverified", execution_id: null, reason: "no_execution", limits: null, code_version: V2 });
  const decision = event("decision", { origin: "agent", question: "apply?", quote: "go", reading: "apply", confirmed: false, prompt_event_id: null, code_version: V2 });
  const message = event("agent_message", { origin: "agent", text: "Everything is done and verified.", code_version: V2 });
  return [started, probe, observation, hypothesis, rejected, prepared, run, passed, change, explained, loose, unverified, decision, message];
}

function data(events: TaskEvent[], extra: Record<string, unknown> = {}) {
  return { task: TASK, repo: "customer-portal", events, model: buildPreviewModel(TASK, events, { repo: "customer-portal" }), pinned: false, version: 1, data_dir: "/repo/.devguide", ...extra };
}

const STATE = { view: "przebieg", step: null, pinned: false, open: new Set<string>() };

/** Removes every <details> block, innermost first, leaving what the page shows without clicking. */
function withoutDetails(html: string): string {
  let text = html;
  for (;;) {
    const next = text.replace(/<details[^>]*>(?:(?!<details)[\s\S])*?<\/details>/g, "");
    if (next === text) return text;
    text = next;
  }
}

function visibleText(html: string): string {
  return withoutDetails(html).replace(/<[^>]+>/g, " ");
}

describe("renderPage", () => {
  it("shows the no-task notice with the /devguide hint", () => {
    const html = renderPage({ task: null, repo: "x", data_dir: "/tmp/x" }, STATE);
    assert.match(html, /Nie ma jeszcze zadania/);
    assert.match(html, /\/devguide/);
    assert.doesNotMatch(html, /class="tabs"/);
  });

  it("renders the header like the mockup: crumbs, title, status line without zero counters, chip", () => {
    const html = renderPage(data(course()), STATE);
    assert.match(html, /<p class="crumbs"><span class="brand">devguide<\/span> \/ customer-portal \/ 20261021-1000-ab12<span class="chip">Aktualizuje się na bieżąco<\/span><\/p>/);
    assert.match(html, /<h1>Export fetches only page one<\/h1>/);
    assert.doesNotMatch(html, /Opis zadania:/);
    assert.match(html, /<p class="status">Agent zakończył turę i czeka na odpowiedź · 1 sprawdzenie przeszło na wcześniejszej wersji kodu, 1 sprawdzenie niepotwierdzone · 1 podejrzenie odrzucone · 1 decyzja niepotwierdzona cytatem<\/p>/);
    const header = html.slice(0, html.indexOf("</header>"));
    assert.doesNotMatch(header.replace(/<[^>]+>/g, " "), /\b0 /);
    assert.match(html, /<footer class="page-footer">Dane z dziennika zadania 20261021-1000-ab12 w \/repo\/\.devguide\. Przyciski decyzji są demonstracją\.<\/footer>/);
  });

  it("renders the three tabs with the chosen one visible and keeps details open per state", () => {
    const events = course();
    const html = renderPage(data(events), { view: "kod", step: null, pinned: false, open: new Set(["diff"]) });
    assert.match(html, /<a href="#przebieg" class="">Przebieg<\/a>/);
    assert.match(html, /<a href="#kod" class="active">Kod AI<\/a>/);
    assert.match(html, /<section id="przebieg" class="view" hidden>/);
    assert.match(html, /<section id="kod" class="view">/);
    assert.match(html, /<details id="diff" class="" open>/);
  });
});

describe("history and step view", () => {
  const events = course();
  const d = data(events);
  const model = d.model;

  it("lists one entry per meaningful step with time, title and subtitle, and no command steps", () => {
    const html: string = renderHistory(model, null);
    assert.equal((html.match(/<li/g) ?? []).length, model.steps.length);
    assert.match(html, /<p class="history-title">Odkrycia i decyzje<\/p>/);
    assert.match(html, /<span class="title">Zgłoszono zadanie<\/span><span class="subtitle">Opis od użytkownika<\/span>/);
    assert.match(html, /<span class="title">Odrzucono podejrzenie<\/span>/);
    assert.match(html, /<span class="title">Przygotowano poprawkę<\/span><span class="subtitle">Później zmieniono pliki<\/span>/);
    assert.match(html, /<span class="title">Fetch every page<\/span><span class="subtitle">1 fragment kodu<\/span>/);
    assert.match(html, /<span class="title">Utworzono plik src\/loose\.ts<\/span><span class="subtitle">Bez objaśnienia od AI<\/span>/);
    assert.match(html, /<span class="title">all rows exported<\/span><span class="subtitle">Sprawdzenie · przeszło na wcześniejszej wersji kodu<\/span>/);
    assert.doesNotMatch(html, /Uruchomiono|npm run export|npm test/);
    assert.match(html, /<time>\d\d:\d\d<\/time>/);
  });

  it("selects the latest step by default and the named one when the state says so", () => {
    const latest = selectedStep(model, STATE);
    assert.equal(latest.id, model.steps[model.steps.length - 1]!.id);
    const chosen = selectedStep(model, { ...STATE, step: model.steps[2]!.id });
    assert.equal(chosen.id, model.steps[2]!.id);
    assert.equal(selectedStep(model, { ...STATE, step: "nope" }).id, latest.id);
    const html: string = renderHistory(model, model.steps[2]!.id);
    assert.equal((html.match(/<li class="selected">/g) ?? []).length, 1);
    assert.match(html, new RegExp(`<li class="selected"><a href="#przebieg/${model.steps[2]!.id}">`));
  });

  it("the check step view shows status, evidence and output and no decision buttons", () => {
    const step = model.steps.find((item) => item.title === "all rows exported")!;
    const html: string = renderStepView(step, d, STATE);
    assert.match(html, /<p class="kicker">Sprawdzenie · przeszło na wcześniejszej wersji kodu<\/p><h2>all rows exported<\/h2><p class="lead">Oczekiwano: 250<\/p>/);
    assert.match(html, /Wynik: <span class="badge warn">przeszło na wcześniejszej wersji kodu<\/span>/);
    assert.match(html, /Dowód z wyjścia <span class="badge ">wynik narzędzia<\/span>: „250 records written”/);
    assert.match(html, /wyjście polecenia <span class="badge ">wynik narzędzia<\/span><\/span><pre>250 records written<\/pre>/);
    assert.match(html, /Od tego wykonania zmieniono: src\/export\.ts, src\/loose\.ts\./);
    assert.match(html, /Nie sprawdza <span class="badge ">AI<\/span>: synthetic data/);
    assert.doesNotMatch(html, /<button/);
    assert.match(html, /<details id="src-ev\d+" class="sources"><summary>Źródła: 2 zdarzenia, polecenia, wersja kodu<\/summary>[\s\S]*<pre>npm test<\/pre>/);
  });

  it("the prepared fix shows the patch and demonstration buttons only while no file changed", () => {
    const begin = event("task_started", { origin: "user", description: "t" });
    const prepared = event("change_prepared", { origin: "agent", text: "Loop over pages", patch: "--- a\n+++ b\n", materials: [], files: ["src/x.ts"] });
    const pendingData = data([begin, prepared]);
    const step = pendingData.model.steps[1]!;
    const html: string = renderStepView(step, pendingData, STATE);
    assert.match(html, /<p class="kicker">Przygotowana poprawka · pliki jeszcze bez zmian<\/p><h2>Przygotowano poprawkę<\/h2>/);
    assert.match(html, /<strong>Poprawka nie została zastosowana\.<\/strong>/);
    assert.match(html, /<button type="button" class="primary" disabled>Zatwierdź i zastosuj lokalnie<\/button><button type="button" disabled>Odeślij do poprawy<\/button>/);
    assert.match(html, /Demonstracja: sterowanie agentem podłączy Etap 6/);
    assert.match(html, /łatka <span class="badge ">przykład od AI<\/span>/);
    const applied = model.steps.find((item) => item.title === "Przygotowano poprawkę")!;
    assert.doesNotMatch(renderStepView(applied, d, STATE), /<button/);
  });

  it("the change step view shows before/after from the tool, the explanation and the code link", () => {
    const step = model.steps.find((item) => item.title === "Fetch every page")!;
    const html: string = renderStepView(step, d, STATE);
    assert.match(html, /<p class="kicker">Zmiana w kodzie · 1 fragment · po poprawce<\/p><h2>Fetch every page<\/h2><p class="lead">export all rows<\/p>/);
    assert.match(html, /przed poprawką <span class="badge ">wynik narzędzia<\/span><\/span><pre>page = 1<\/pre>/);
    assert.match(html, /po poprawce <span class="badge ">wynik narzędzia<\/span><\/span><pre>loop over pages<\/pre>/);
    assert.match(html, /<h4>Jak to działa <span class="badge ">AI<\/span><\/h4><p>loop until empty<\/p>/);
    assert.doesNotMatch(html, /Założenia i ograniczenia/);
    assert.match(html, /Przykład od AI\. Nie jest wynikiem sprawdzenia\./);
    assert.match(html, /<a href="#kod" data-target="card-ev\d+">Przejrzyj 1 fragment kodu z objaśnieniem →<\/a>/);
  });

  it("the resolution step keeps the rejected hypothesis and links to it; the unverified check names what is missing", () => {
    const resolution = model.steps.find((item) => item.title === "Odrzucono podejrzenie")!;
    const html: string = renderStepView(resolution, d, STATE);
    assert.match(html, /Podejrzenie: <em>the page parameter is ignored<\/em> <a href="#przebieg\/ev\d+">zobacz krok<\/a>/);
    const hypothesis = model.steps.find((item) => item.title === "the page parameter is ignored")!;
    assert.match(renderStepView(hypothesis, d, STATE), /Stan: <span class="badge warn">odrzucone<\/span> <span class="muted">the parameter is passed<\/span>/);
    const unverified = model.steps.find((item) => item.title === "filters apply")!;
    const check: string = renderStepView(unverified, d, STATE);
    assert.match(check, /deklaracja AI: „przeszło”/);
    assert.match(check, /Dlaczego niepotwierdzone: brak zarejestrowanego wykonania polecenia\./);
    assert.match(check, /Dowód podany przez AI, nieznaleziony w żadnym wyjściu: „ok”/);
    assert.match(check, /Nie zarejestrowano wykonania tego polecenia/);
  });

  it("the main text of every step view has no commands, ids, versions or raw agent messages; sources have them", () => {
    for (const step of model.steps) {
      const html: string = renderStepView(step, d, STATE);
      const visible = visibleText(html);
      assert.doesNotMatch(visible, /npm run export|npm test|npm run filters/, step.title);
      assert.doesNotMatch(visible, /ev0000\d\d/, step.title);
      assert.doesNotMatch(visible, /cccccccccccc/, step.title);
      assert.doesNotMatch(visible, /\d\d:\d\d:\d\d/, step.title);
      assert.doesNotMatch(visible, /Everything is done and verified/, step.title);
      assert.doesNotMatch(visible, />\s*brak\s*</i, step.title);
      assert.doesNotMatch(html, /<script>alert/);
    }
    const last = model.steps[model.steps.length - 1]!;
    const html: string = renderStepView(last, d, STATE);
    assert.match(html, /wypowiedź AI <span class="badge ">nie jest potwierdzeniem<\/span><\/span><pre>Everything is done and verified\.<\/pre>/);
    assert.match(html, /zdarzenie ev\d+ · wersja kodu: commit cccccccccccc/);
  });

  it("a task without findings shows the task step and one factual step per command; no code or checks tabs", () => {
    const begin = event("task_started", { origin: "user", description: "Zmień hello na greetings" });
    const one = event("command_run", { origin: "tool", command: "sed -i 's/hello/greetings/' hello.txt && cat hello.txt", stdout: "greetings\n", stderr: "", interrupted: false, exit_code: null });
    const two = event("command_run", { origin: "tool", command: "echo done", stdout: "done\n", stderr: "", interrupted: false, exit_code: null });
    const message = event("agent_message", { origin: "agent", text: "Replaced the word." });
    const simple = data([begin, one, two, message]);
    assert.equal(simple.model.steps.length, 3);
    const taskHtml: string = renderStepView(simple.model.steps[0]!, simple, STATE);
    assert.match(taskHtml, /<h2>Zgłoszono zadanie<\/h2><p class="lead">Zmień hello na greetings<\/p><p class="note">AI nie zapisało żadnych ustaleń/);
    const runHtml: string = renderStepView(simple.model.steps[1]!, simple, STATE);
    assert.match(runHtml, /<p class="kicker">Polecenie · bez zapisanego celu<\/p><h2>Polecenie na hello\.txt<\/h2>/);
    assert.match(runHtml, /wyjście polecenia <span class="badge ">wynik narzędzia<\/span><\/span><pre>greetings<\/pre>/);
    assert.doesNotMatch(visibleText(runHtml), /sed -i|cat hello/);
    assert.match(runHtml, /<details id="src-[\s\S]*<pre>sed -i/);
    const lastHtml: string = renderStepView(simple.model.steps[2]!, simple, STATE);
    assert.doesNotMatch(visibleText(lastHtml), /Replaced the word/);
    assert.match(lastHtml, /<pre>Replaced the word\.<\/pre>/);
    const history: string = renderHistory(simple.model, null);
    assert.match(history, /<span class="title">Polecenie na hello\.txt<\/span><span class="subtitle">wyjście: „greetings”<\/span>/);
    assert.match(history, /<span class="title">Polecenie<\/span><span class="subtitle">wyjście: „done”<\/span>/);
    assert.doesNotMatch(history, /Uruchomiono/);
    const page: string = renderPage(simple, STATE);
    assert.doesNotMatch(page, /href="#sprawdzenia"|href="#kod"|<section id="sprawdzenia"|<section id="kod"/);
    assert.match(page, /<p class="status">Agent zakończył turę i czeka na odpowiedź · brak zapisanych sprawdzeń<\/p>/);
    assert.deepEqual(visibleViews(simple.model).map((item: { id: string }) => item.id), ["przebieg"]);
  });

  it("a change step lists the checks executed after it with links, or says none were recorded", () => {
    const step = model.steps.find((item) => item.title === "Fetch every page")!;
    const html: string = renderStepView(step, d, STATE);
    assert.match(html, /<h4>Sprawdzenia po tej zmianie<\/h4><ul><li><span class="badge warn">niepotwierdzone<\/span> <a href="#przebieg\/ev\d+">filters apply<\/a><\/li><\/ul>/);
    const begin = event("task_started", { origin: "user", description: "t" });
    const change = event("file_changed", { origin: "tool", path: "src/x.ts", created: false, before: "1", after: "2", patch: [HUNK], tool: "Edit", files: ["src/x.ts"] });
    const alone = data([begin, change]);
    assert.match(renderStepView(alone.model.steps[1]!, alone, STATE), /Po tej zmianie nie zapisano żadnego sprawdzenia\./);
  });
});

describe("other views", () => {
  const events = course();
  const model = buildPreviewModel(TASK, events);

  it("renderCode has cards, proposals, unexplained changes and the diff, without a legend", () => {
    const html: string = renderCode(model, events, STATE);
    assert.match(html, /<h3>Fetch every page<\/h3>/);
    assert.match(html, /Loop over pages <span class="badge warn">niezastosowana<\/span>/);
    assert.match(html, /Zmiany bez objaśnienia od AI[\s\S]*?src\/loose\.ts/);
    assert.match(html, /<details id="diff"/);
    assert.doesNotMatch(html, /summary-line/);
  });

  it("renderChecks separates verified from unverified and never lists plain commands", () => {
    const html: string = renderChecks(model, events, STATE);
    assert.match(html, /<p class="status">1 przeszło na wcześniejszej wersji kodu, 1 niepotwierdzone\.<\/p>/);
    assert.equal(checksSummary({ current_passed: 2, stale_passed: 1, failed: 0, inconclusive: 0, unverified: 1 }), "2 sprawdzenia potwierdzają bieżący kod, 1 przeszło na wcześniejszej wersji kodu, 1 niepotwierdzone.");
    assert.equal(checksSummary({ current_passed: 0, stale_passed: 0, failed: 0, inconclusive: 0, unverified: 0 }), "");
    assert.match(html, /Sprawdzenia potwierdzone wykonaniem/);
    assert.match(html, /Sprawdzenia niepotwierdzone/);
    assert.doesNotMatch(html, /Polecenia uruchomione bez oceny|npm run export -- --dry/);
    assert.doesNotMatch(html, /wersja kodu wykonania|cccccccccccc|kod wyjścia nieznany/);
    assert.match(html, /<dt>Nie sprawdza<\/dt><dd>synthetic data <span class="badge ">AI<\/span><\/dd>/);
    assert.match(html, /<a href="#przebieg\/ev\d+">Krok w przebiegu<\/a>/);
    assert.doesNotMatch(html, /summary-line/);
    const empty: string = renderChecks(buildPreviewModel(TASK, []), [], STATE);
    assert.match(empty, /nie zapisało jeszcze żadnego sprawdzenia/);
    assert.doesNotMatch(empty, /<h2>/);
  });
});

describe("helpers", () => {
  it("escapeHtml, plural and parseHash", () => {
    assert.equal(escapeHtml(`<a href="x">&'`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
    assert.equal(plural(1, "zmiana", "zmiany", "zmian"), "1 zmiana");
    assert.equal(plural(4, "zmiana", "zmiany", "zmian"), "4 zmiany");
    assert.equal(plural(14, "zmiana", "zmiany", "zmian"), "14 zmian");
    assert.equal(plural(22, "zmiana", "zmiany", "zmian"), "22 zmiany");
    assert.deepEqual(parseHash("#przebieg/change-ab12"), { view: "przebieg", step: "change-ab12" });
    assert.deepEqual(parseHash("#kod"), { view: "kod", step: null });
    assert.deepEqual(parseHash(""), { view: "przebieg", step: null });
    assert.deepEqual(parseHash("#nope/x"), { view: "przebieg", step: "x" });
  });
});
