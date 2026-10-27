// The DevGuide preview page. Pure functions turn the server's JSON into HTML
// strings; the browser part at the bottom fetches, listens for updates and
// repaints while keeping the chosen view, the chosen step and the open
// details. The same file is imported by ui/preview.test.ts in Node, which is
// why nothing above the browser part touches `document`.
//
// Layout (design D11): task header, tabs, and for "Przebieg" the history of
// meaningful steps on the left with the selected step's own view on the
// right. Raw commands, times, origins and ids live only in each step's
// collapsible "Źródła". Plain JavaScript on purpose: the browser does not run
// TypeScript and the project has no build step. Every piece of event text
// goes through escapeHtml before it reaches the page.

export const VIEWS = [
  { id: "przebieg", title: "Przebieg" },
  { id: "kod", title: "Kod AI" },
  { id: "sprawdzenia", title: "Wyniki sprawdzeń" },
];

export const ORIGIN_LABEL = { user: "użytkownik", tool: "narzędzie", agent: "AI", devguide: "DevGuide" };

const TOOL_RESULT = "wynik narzędzia";
const ILLUSTRATION = "przykład od AI";
const DEMO_NOTE = "Demonstracja: sterowanie agentem podłączy Etap 6. Przyciski niczego nie zmieniają w dzienniku ani w repozytorium.";

const CHECK_STATUS = {
  passed: { text: "przeszło", cls: "ok" },
  failed: { text: "nie przeszło", cls: "bad" },
  inconclusive: { text: "nierozstrzygnięte", cls: "warn" },
  unverified: { text: "niepotwierdzone", cls: "warn" },
};

const CHECK_REASON = {
  no_execution: "brak zarejestrowanego wykonania polecenia",
  evidence_not_found: "dowodu nie ma w wyjściu polecenia",
  no_evidence: "nie podano dowodu z wyjścia polecenia",
};

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Polish plural: plural(3, "zmiana", "zmiany", "zmian") -> "3 zmiany". */
export function plural(count, one, few, many) {
  const n = Math.abs(count);
  const last = n % 10;
  const tens = n % 100;
  let word = many;
  if (n === 1) word = one;
  else if (last >= 2 && last <= 4 && (tens < 12 || tens > 14)) word = few;
  return `${count} ${word}`;
}

/** `#przebieg/<step id>` -> { view, step }; anything unknown -> the first view. */
export function parseHash(hash) {
  const raw = String(hash ?? "").replace(/^#/, "");
  const [view, ...rest] = raw.split("/");
  const known = VIEWS.some((item) => item.id === view) ? view : VIEWS[0].id;
  const step = rest.length > 0 && rest.join("/").length > 0 ? decodeURIComponent(rest.join("/")) : null;
  return { view: known, step };
}

/** The tabs worth showing: "Kod AI" only with code to review, "Wyniki sprawdzeń" only with checks. */
export function visibleViews(model) {
  const hasCode = model.code.cards.length > 0 || model.code.unexplained.length > 0 || model.code.proposals.length > 0;
  const hasChecks = model.checks.items.length > 0;
  return VIEWS.filter((item) => item.id === "przebieg" || (item.id === "kod" && hasCode) || (item.id === "sprawdzenia" && hasChecks));
}

/** The step the view shows: the one the state names when it exists, otherwise the latest. */
export function selectedStep(model, state) {
  if (!model || model.steps.length === 0) return null;
  const wanted = state && state.step ? model.steps.find((step) => step.id === state.step) : null;
  return wanted ?? model.steps[model.steps.length - 1];
}

function clockShort(time) {
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function clockFull(time) {
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) return "";
  return `${clockShort(time)}:${String(date.getSeconds()).padStart(2, "0")}`;
}

function shortVersion(version) {
  if (!version || (!version.commit && !version.working_tree)) return "nieznana";
  return `commit ${version.commit ? version.commit.slice(0, 12) : "nieznany"}, drzewo ${version.working_tree ? version.working_tree.slice(0, 12) : "nieznane"}`;
}

function badge(text, cls = "") {
  return `<span class="badge ${cls}">${escapeHtml(text)}</span>`;
}

function originBadge(origin) {
  return badge(ORIGIN_LABEL[origin] ?? origin, `origin-${origin}`);
}

function pre(text, label) {
  const body = text === null || text === undefined || text === "" ? '<span class="muted">(pusto)</span>' : escapeHtml(text);
  return `${label ? `<span class="label">${label}</span>` : ""}<pre>${body}</pre>`;
}

function details(id, summary, body, state, extraClass = "") {
  const open = state && state.open && state.open.has(id) ? " open" : "";
  return `<details id="${escapeHtml(id)}" class="${extraClass}"${open}><summary>${summary}</summary><div class="body">${body}</div></details>`;
}

// --- page ----------------------------------------------------------------------

export function renderPage(data, state) {
  if (!data || !data.task) {
    return `<header class="task-header"><p class="crumbs"><span class="brand">devguide</span>${data && data.repo ? ` / ${escapeHtml(data.repo)}` : ""}</p><h1>Nie ma jeszcze zadania</h1><p class="goal">Wpisz <code>/devguide &lt;opis zadania&gt;</code> w Claude Code${data && data.data_dir ? ` (katalog danych: ${escapeHtml(data.data_dir)})` : ""}. Strona zaktualizuje się sama.</p></header>`;
  }
  const views = visibleViews(data.model);
  const view = state && views.some((item) => item.id === state.view) ? state.view : VIEWS[0].id;
  const tabs = views.map((item) => `<a href="#${item.id}" class="${item.id === view ? "active" : ""}">${item.title}</a>`).join("");
  const step = selectedStep(data.model, state);
  return [
    renderHeader(data),
    `<nav class="tabs">${tabs}</nav>`,
    `<section id="przebieg" class="view"${view === "przebieg" ? "" : " hidden"}>${renderHistoryView(data, step, state)}</section>`,
    views.some((item) => item.id === "kod") ? `<section id="kod" class="view"${view === "kod" ? "" : " hidden"}>${renderCode(data.model, data.events, state)}</section>` : "",
    views.some((item) => item.id === "sprawdzenia") ? `<section id="sprawdzenia" class="view"${view === "sprawdzenia" ? "" : " hidden"}>${renderChecks(data.model, data.events, state)}</section>` : "",
    `<footer class="page-footer">Dane z dziennika zadania ${escapeHtml(data.task.id)}${data.data_dir ? ` w ${escapeHtml(data.data_dir)}` : ""}. Przyciski decyzji są demonstracją.</footer>`,
  ].join("");
}

export function renderHeader(data) {
  const header = data.model.header;
  const crumbs = [`<span class="brand">devguide</span>`, header.repo ? escapeHtml(header.repo) : null, escapeHtml(header.task_id)].filter(Boolean).join(" / ");
  const chip = data.pinned ? "Przypięte do tego zadania" : "Aktualizuje się na bieżąco";
  return `<header class="task-header"><p class="crumbs">${crumbs}<span class="chip">${chip}</span></p><h1>${escapeHtml(header.title)}</h1>${header.goal ? `<p class="goal">Opis zadania: ${escapeHtml(header.goal)}</p>` : ""}<p class="status">${escapeHtml(header.status_line)}</p></header>`;
}

// --- history and step view --------------------------------------------------------

function renderHistoryView(data, step, state) {
  const model = data.model;
  if (model.steps.length === 0) return `<p class="notice">Zadanie nie ma jeszcze żadnego kroku.</p>`;
  return `<div class="layout">${renderHistory(model, step ? step.id : null)}${renderStepView(step, data, state)}</div>`;
}

export function renderHistory(model, selectedId) {
  const items = model.steps
    .map((step) => {
      const selected = step.id === selectedId ? ' class="selected"' : "";
      return `<li${selected}><a href="#przebieg/${encodeURIComponent(step.id)}"><time>${clockShort(step.time)}</time><span class="text"><span class="title">${escapeHtml(step.title)}</span><span class="subtitle">${escapeHtml(step.subtitle)}</span></span></a></li>`;
    })
    .join("");
  return `<nav class="history" aria-label="Kroki zadania"><p class="history-title">Odkrycia i decyzje</p><ol>${items}</ol></nav>`;
}

export function renderStepView(step, data, state) {
  if (!step) return `<section class="step-view"><p class="notice">Wybierz krok z historii.</p></section>`;
  const parts = [];
  parts.push(`<a class="back" href="#przebieg/${encodeURIComponent(step.id)}">← Kroki</a>`);
  parts.push(`<p class="kicker">${escapeHtml(step.kicker)}</p>`);
  parts.push(`<h2>${escapeHtml(step.title)}</h2>`);
  if (step.lead) parts.push(`<p class="lead">${escapeHtml(step.lead)}</p>`);
  for (const block of step.blocks) parts.push(renderBlock(block, step, data));
  if (step.code_link && step.code_link.fragments > 0) {
    parts.push(`<p class="code-link"><a href="#kod" data-target="${escapeHtml(step.code_link.target)}">Przejrzyj ${plural(step.code_link.fragments, "fragment kodu z objaśnieniem", "fragmenty kodu z objaśnieniami", "fragmentów kodu z objaśnieniami")} →</a></p>`);
  }
  if (step.checks_after) parts.push(renderChecksAfter(step.checks_after));
  if (step.decision) parts.push(renderDecision(step));
  parts.push(details(`src-${step.id}`, `Źródła: ${plural(step.sources.length, "zdarzenie", "zdarzenia", "zdarzeń")}, polecenia, wersja kodu`, renderSources(step.sources), state, "sources"));
  return `<section class="step-view kind-${escapeHtml(step.kind)}" id="step-view">${parts.join("")}</section>`;
}

function renderChecksAfter(refs) {
  if (refs.length === 0) return `<p class="note">Po tej zmianie nie zapisano żadnego sprawdzenia.</p>`;
  const items = refs.map((ref) => `<li>${badge(ref.status_text, ref.tone)} <a href="#przebieg/${encodeURIComponent(ref.step_id)}">${escapeHtml(ref.title)}</a></li>`).join("");
  return `<div class="block checks-after"><h4>Sprawdzenia po tej zmianie</h4><ul>${items}</ul></div>`;
}

function renderBlock(block, step, data) {
  switch (block.kind) {
    case "note":
      return `<p class="note">${escapeHtml(block.text)}</p>`;
    case "output":
      return `<div class="block">${pre(block.excerpt, `${escapeHtml(block.label)} ${badge(TOOL_RESULT)}`)}${block.truncated ? `<p class="muted small">… pełne wyjście w źródłach</p>` : ""}</div>`;
    case "missing":
      return `<p class="missing">${escapeHtml(block.text)}</p>`;
    case "example":
      return `<div class="block example">${block.materials.map((material) => `${pre(material.excerpt, `${escapeHtml(material.label)} ${badge(material.nature === "tool" ? TOOL_RESULT : ILLUSTRATION)}`)}${material.truncated ? `<p class="muted small">… pełna treść w źródłach</p>` : ""}`).join("")}<p class="caption">${escapeHtml(block.note)}</p></div>`;
    case "diff":
      return `<div class="block diff">${block.changes.map(renderChange).join("")}</div>`;
    case "explanation":
      return `<div class="block explanation"><h4>Jak to działa ${badge("AI")}</h4><p>${escapeHtml(block.mechanism)}</p>${block.assumptions ? `<h4>Założenia i ograniczenia ${badge("AI")}</h4><p>${escapeHtml(block.assumptions)}</p>` : ""}</div>`;
    case "patch":
      return `<div class="block patch">${pre(block.excerpt, `łatka ${badge(ILLUSTRATION)}`)}${block.truncated ? `<p class="muted small">… pełna łatka w zakładce Kod AI</p>` : ""}<p class="caption">${escapeHtml(block.note)}</p></div>`;
    case "check":
      return renderCheckBlock(block);
    case "hypothesis_state":
      return renderHypothesisState(block, step, data);
    case "decision_record":
      return `<div class="block decision-record"><dl><dt>Pytanie</dt><dd>${escapeHtml(block.question)}</dd><dt>Odpowiedź użytkownika</dt><dd>„${escapeHtml(block.quote)}”</dd><dt>Odczyt AI</dt><dd>${escapeHtml(block.reading)}</dd></dl><p>${block.confirmed ? badge("potwierdzona słowami użytkownika", "ok") : `${badge("niepotwierdzona", "warn")} <span class="muted">cytatu nie ma w żadnej wypowiedzi użytkownika w tym zadaniu</span>`}</p></div>`;
    default:
      return "";
  }
}

function renderChange(change) {
  const where = change.lines ? ` (wiersze ${change.lines.start}–${change.lines.end})` : "";
  const after = pre(change.after, `po poprawce ${badge(TOOL_RESULT)}`);
  const before = change.created ? `<p class="muted small">nowy plik, nie było wersji „przed”</p>` : pre(change.before, `przed poprawką ${badge(TOOL_RESULT)}`);
  return `<div class="change"><p class="path">${escapeHtml(change.path)}${escapeHtml(where)}</p><div class="snippets"><div>${before}</div><div>${after}</div></div></div>`;
}

function renderCheckBlock(block) {
  const parts = [];
  parts.push(`<p class="verdict">Wynik: ${badge(block.status_text, block.tone)}${block.status === "unverified" ? ` <span class="muted">deklaracja AI: „${escapeHtml(block.claimed_text)}”</span>` : ""}</p>`);
  if (block.reason_text) parts.push(`<p class="missing">Dlaczego niepotwierdzone: ${escapeHtml(block.reason_text)}.</p>`);
  if (block.evidence) {
    parts.push(block.evidence_verified ? `<p class="evidence">Dowód z wyjścia ${badge(TOOL_RESULT)}: „${escapeHtml(block.evidence)}”</p>` : `<p class="evidence">Dowód podany przez AI, nieznaleziony w żadnym wyjściu: „${escapeHtml(block.evidence)}”</p>`);
  }
  if (block.output) parts.push(`${pre(block.output.excerpt, `${block.output.stderr ? "wyjście błędów polecenia" : "wyjście polecenia"} ${badge(TOOL_RESULT)}`)}${block.output.truncated ? `<p class="muted small">… pełne wyjście w źródłach</p>` : ""}`);
  if (block.changed_since) {
    parts.push(
      block.changed_since.length > 0
        ? `<p class="stale">Od tego wykonania zmieniono: ${block.changed_since.map(escapeHtml).join(", ")}. Wynik nie potwierdza bieżącego rozwiązania.</p>`
        : `<p class="stale">Od tego wykonania kod zmienił się poza narzędziami Claude Code (inny odcisk drzewa roboczego). Wynik nie potwierdza bieżącego rozwiązania.</p>`,
    );
  }
  if (block.limits) parts.push(`<p class="limits">Nie sprawdza ${badge("AI")}: ${escapeHtml(block.limits)}</p>`);
  return `<div class="block check">${parts.join("")}</div>`;
}

function renderHypothesisState(block, step, data) {
  const parts = [];
  if (step.kind === "resolution") {
    const target = data && data.model ? data.model.steps.find((item) => item.kind === "hypothesis" && item.id === step.refs.hypothesis_id) : null;
    parts.push(`<p>Podejrzenie: <em>${escapeHtml(block.hypothesis)}</em>${target ? ` <a href="#przebieg/${encodeURIComponent(target.id)}">zobacz krok</a>` : ""}</p>`);
  } else {
    parts.push(`<p>Stan: ${badge(block.status_text, block.status === "rejected" ? "warn" : block.status === "confirmed" ? "ok" : "")}${block.resolution ? ` <span class="muted">${escapeHtml(block.resolution)}</span>` : ""}</p>`);
    if (block.status === "open") parts.push(`<p class="muted small">Ani potwierdzone, ani odrzucone; sprawdzenia są osobnymi krokami.</p>`);
  }
  return `<div class="block hypothesis">${parts.join("")}</div>`;
}

function renderDecision(step) {
  return `<div class="decision"><p><strong>Poprawka nie została zastosowana.</strong> Zatwierdzasz dokładnie pokazaną łatkę; zmiana łatki lub kodu bazowego wymaga ponownej zgody.</p><div class="buttons"><button type="button" class="primary" disabled>Zatwierdź i zastosuj lokalnie</button><button type="button" disabled>Odeślij do poprawy</button></div><p class="caption">${escapeHtml(DEMO_NOTE)}</p></div>`;
}

function renderSources(sources) {
  const rows = sources
    .map((source) => {
      const extra = [];
      if (source.command !== null) extra.push(pre(source.command, "polecenie"));
      if (source.stdout) extra.push(pre(source.stdout, `pełne wyjście ${badge(TOOL_RESULT)}`));
      if (source.stderr) extra.push(pre(source.stderr, `wyjście błędów ${badge(TOOL_RESULT)}`));
      if (source.command !== null) extra.push(`<p class="muted small">kod wyjścia nieznany</p>`);
      if (source.text !== null) extra.push(pre(source.text, source.kind === "user_prompt" ? "tekst użytkownika" : source.kind === "agent_message" ? `wypowiedź AI ${badge("nie jest potwierdzeniem")}` : "błąd narzędzia"));
      return `<li><p><time>${clockFull(source.time)}</time>${originBadge(source.origin)} ${escapeHtml(source.sentence)}</p>${extra.join("")}<p class="footer">zdarzenie ${escapeHtml(source.event_id)} · wersja kodu: ${escapeHtml(shortVersion(source.code_version))}${source.files && source.files.length ? ` · pliki: ${source.files.map(escapeHtml).join(", ")}` : ""}</p></li>`;
    })
    .join("");
  return `<ul class="sources-list">${rows}</ul>`;
}

// --- code ----------------------------------------------------------------------

export function renderCode(model, events, state) {
  const code = model.code;
  const parts = [];
  if (code.cards.length === 0 && code.unexplained.length === 0 && code.proposals.length === 0) {
    parts.push(`<p class="notice">AI nie zmieniło jeszcze żadnego pliku narzędziem Write ani Edit i nie zaproponowało zmiany.</p>`);
  }
  if (code.cards.length > 0) {
    parts.push(`<h2>Poprawki</h2>`);
    for (const card of code.cards) parts.push(renderCard(card, state));
  }
  if (code.proposals.length > 0) {
    parts.push(`<h2>Propozycje</h2>`);
    for (const proposal of code.proposals) {
      parts.push(`<article class="card" id="p-${escapeHtml(proposal.id)}"><h3>${escapeHtml(proposal.text)} ${badge("niezastosowana", "warn")}</h3>${proposal.patch ? pre(proposal.patch, `łatka ${badge(ILLUSTRATION)}`) : ""}${materialsHtml(proposal.materials)}</article>`);
    }
  }
  if (code.unexplained.length > 0) {
    parts.push(`<h2>Zmiany bez objaśnienia od AI</h2><p class="muted">Zarejestrowane przez narzędzie; AI nie zapisało, po co je wykonało.</p>`);
    for (const change of code.unexplained) parts.push(`<article class="card" id="u-${escapeHtml(change.event_id)}">${renderChange(change)}${versionDetails(change, state)}</article>`);
  }
  if (code.diff.length > 0) {
    const body = code.diff.map((file) => `${file.partial ? `<p class="warning">${escapeHtml(file.path)}: łatka niedostępna dla części zmian, pokazano fragmenty przed i po.</p>` : ""}<pre>${escapeHtml(file.text)}</pre>`).join("");
    parts.push(`<h2>Pełny diff</h2>${details("diff", `Wszystkie zarejestrowane łatki, według pliku ${badge(TOOL_RESULT)}`, body, state)}`);
  }
  return parts.join("");
}

function materialsHtml(materials) {
  if (!materials || materials.length === 0) return "";
  return materials.map((material) => pre(material.content, `${escapeHtml(material.label)} ${badge(material.nature === "observed" ? TOOL_RESULT : ILLUSTRATION)}`)).join("");
}

function versionDetails(change, state) {
  return details(`v-${change.event_id}`, `<span class="muted">Szczegóły wersji</span>`, `<p class="footer">${escapeHtml(shortVersion(change.code_version))} · zdarzenie ${escapeHtml(change.event_id)} · ${escapeHtml(change.tool)}</p>`, state);
}

export function renderCard(card, state) {
  const changes = card.changes.length > 0 ? card.changes.map((change) => `${renderChange(change)}${versionDetails(change, state)}`).join("") : `<p class="missing">Żadna zmiana wykonana narzędziem nie pasuje do tego objaśnienia.</p>`;
  return `<article class="card" id="card-${escapeHtml(card.id)}"><h3>${escapeHtml(card.title)}</h3><p class="lead">${escapeHtml(card.purpose)}</p>${changes}<div class="explanation"><h4>Jak to działa ${badge("AI")}</h4><p>${escapeHtml(card.mechanism)}</p>${card.materials.length > 0 ? `<h4>Przykład ${badge(ILLUSTRATION)}</h4>${materialsHtml(card.materials)}` : ""}${card.assumptions ? `<h4>Założenia i ograniczenia ${badge("AI")}</h4><p>${escapeHtml(card.assumptions)}</p>` : ""}</div></article>`;
}

// --- checks --------------------------------------------------------------------

export function renderChecks(model, events, state) {
  const byId = new Map(events.map((event) => [event.id, event]));
  const checks = model.checks;
  const parts = [];
  const verified = checks.items.filter((item) => item.status !== "unverified");
  const unverified = checks.items.filter((item) => item.status === "unverified");
  if (checks.items.length === 0) {
    parts.push(`<p class="notice">AI nie zapisało jeszcze żadnego sprawdzenia.</p>`);
  }
  if (checks.items.length > 0) parts.push(`<p class="status">${escapeHtml(checksSummary(checks.counts))}</p>`);
  if (verified.length > 0) {
    parts.push(`<h2>Sprawdzenia potwierdzone wykonaniem</h2><ul class="list">${verified.map((item) => `<li>${checkItem(item, byId, state)}</li>`).join("")}</ul>`);
  }
  if (unverified.length > 0) {
    parts.push(`<h2>Sprawdzenia niepotwierdzone</h2><p class="muted">Zapisane przez AI bez wykonania albo bez dowodu w wyjściu; deklarowany wynik jest tylko deklaracją AI.</p><ul class="list">${unverified.map((item) => `<li>${checkItem(item, byId, state)}</li>`).join("")}</ul>`);
  }
  return parts.join("");
}

/** One sentence with the counts that are not zero, in plain words. */
export function checksSummary(counts) {
  const parts = [];
  if (counts.current_passed > 0) parts.push(`${plural(counts.current_passed, "sprawdzenie potwierdza", "sprawdzenia potwierdzają", "sprawdzeń potwierdza")} bieżący kod`);
  if (counts.stale_passed > 0) parts.push(`${plural(counts.stale_passed, "przeszło", "przeszły", "przeszło")} na wcześniejszej wersji kodu`);
  if (counts.failed > 0) parts.push(`${plural(counts.failed, "nie przeszło", "nie przeszły", "nie przeszło")}`);
  if (counts.inconclusive > 0) parts.push(`${counts.inconclusive} nierozstrzygnięte`);
  if (counts.unverified > 0) parts.push(`${plural(counts.unverified, "niepotwierdzone", "niepotwierdzone", "niepotwierdzonych")}`);
  const line = parts.join(", ");
  return line.length > 0 ? `${line.charAt(0).toUpperCase()}${line.slice(1)}.` : "";
}

function checkItem(item, byId, state) {
  const status = CHECK_STATUS[item.status] ?? { text: item.status, cls: "" };
  const stale = item.status !== "unverified" && !item.current;
  const statusText = stale ? `${status.text} na wcześniejszej wersji kodu` : status.text;
  const claimed = item.status === "unverified" ? ` <span class="muted">deklaracja AI: „${escapeHtml(CHECK_STATUS[item.claimed] ? CHECK_STATUS[item.claimed].text : item.claimed)}”</span>` : "";
  const summary = `${badge(statusText, stale ? "warn" : status.cls)}<span class="sentence">${escapeHtml(item.what)}</span>${claimed}`;
  const execution = item.execution_id ? byId.get(item.execution_id) : null;
  const body = [
    `<dl><dt>Oczekiwanie</dt><dd>${escapeHtml(item.expected)}</dd><dt>Dowód</dt><dd>„${escapeHtml(item.evidence)}”</dd>`,
    item.reason ? `<dt>Powód</dt><dd>${escapeHtml(CHECK_REASON[item.reason] ?? item.reason)}</dd>` : "",
    item.limits ? `<dt>Nie sprawdza</dt><dd>${escapeHtml(item.limits)} ${badge("AI")}</dd>` : "",
    `</dl>`,
    stale ? `<p class="stale">Od tego wykonania zmieniono: ${item.changed_since.length > 0 ? item.changed_since.map(escapeHtml).join(", ") : "kod poza narzędziami Claude Code"}. Wynik nie potwierdza bieżącego rozwiązania.</p>` : "",
    execution ? `${pre(execution.command, "polecenie")}${pre(execution.stdout, `pełne wyjście ${badge(TOOL_RESULT)}`)}${execution.stderr ? pre(execution.stderr, `wyjście błędów ${badge(TOOL_RESULT)}`) : ""}` : `<p class="missing">Nie zarejestrowano wykonania polecenia.</p>`,
    `<p class="muted small"><a href="#przebieg/${escapeHtml(item.id)}">Krok w przebiegu</a> (identyfikatory i wersja kodu w jego źródłach)</p>`,
  ].join("");
  return details(`c-${item.id}`, summary, body, state, "row");
}

// --- browser -------------------------------------------------------------------

if (typeof document !== "undefined") {
  const root = document.getElementById("app");
  const initial = parseHash(location.hash);
  const state = { view: initial.view, step: initial.step, pinned: initial.step !== null, open: new Set() };
  let data = null;
  let scrollToStep = false;

  function paint() {
    for (const element of root.querySelectorAll("details")) {
      if (element.open) state.open.add(element.id);
      else state.open.delete(element.id);
    }
    const y = window.scrollY;
    root.innerHTML = renderPage(data, state);
    if (scrollToStep) {
      scrollToStep = false;
      const view = root.querySelector("#step-view");
      if (view && window.matchMedia("(max-width: 900px)").matches) view.scrollIntoView({ block: "start" });
    } else {
      window.scrollTo(0, y);
    }
  }

  async function refresh() {
    try {
      const response = await fetch("/api/preview", { cache: "no-store" });
      data = await response.json();
      if (!state.pinned) state.step = null;
      paint();
    } catch (error) {
      root.innerHTML = `<p class="notice">Nie udało się pobrać danych podglądu: ${escapeHtml(error.message)}. Czy serwer działa?</p>`;
    }
  }

  window.addEventListener("hashchange", () => {
    const parsed = parseHash(location.hash);
    state.view = parsed.view;
    if (parsed.step) {
      state.step = parsed.step;
      state.pinned = true;
      scrollToStep = true;
    }
    paint();
  });

  root.addEventListener("click", (event) => {
    const back = event.target.closest("a.back");
    if (back) {
      event.preventDefault();
      const history = root.querySelector(".history");
      if (history) history.scrollIntoView({ block: "start" });
      return;
    }
    const codeLink = event.target.closest("a.code-link a, p.code-link a");
    if (codeLink && codeLink.dataset.target) {
      event.preventDefault();
      location.hash = "#kod";
      const target = document.getElementById(codeLink.dataset.target);
      if (target) target.scrollIntoView({ block: "start" });
    }
  });

  const source = new EventSource("/api/updates");
  source.addEventListener("update", () => {
    refresh();
  });
  source.addEventListener("error", () => {
    // EventSource reconnects on its own; the server sends an update on connect.
  });
  refresh();
}
