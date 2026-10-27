# Design

## Context

Motywacja: `proposal.md` — Why. Wymagania: `specs/preview-server`, `specs/preview-timeline`, `specs/preview-code`, `specs/preview-checks`, delta `specs/task-event-log`.

Stan repozytorium po Etapie 3:

- `process/events.ts` — unia zdarzeń po `kind`; `file_changed` ma `path`, `created`, `before`, `after` (dla `Edit` fragmenty `oldString`/`newString`, dla `Write` cały plik), `patch` (`structuredPatch` z Claude Code: hunki `oldStart`, `oldLines`, `newStart`, `newLines`, `lines`, pusty dla nowego pliku) i `tool`; `command_run` ma `command`, `stdout`, `stderr`, `interrupted`, `exit_code: null`; `check` ma `what`, `expected`, `command`, `evidence`, `claimed`, `status`, `execution_id`, `reason`.
- `process/task-log.ts` — `currentTask(dir)`, `readTask(dir, id)`, `readEvents(task)`, `appendAgentEvent(task, kind, draft)` z regułami dla `check`, `decision`, `hypothesis_resolved`; `process/replay.ts` — `summarize(task, events)` (hipotezy, sprawdzenia z `current`, decyzje, pliki, ostatnia wersja kodu), `describeEvent(event)` (jedno zdanie po polsku).
- `process/cli.ts` — `record <kind>` z flagami `parseArgs`, `replay --json` zwraca `{ task, events, summary }`.
- `process/paths.ts` — `resolveDataDir(env, cwd)`, `current-task`, `tasks/<id>/events.jsonl`.
- `ui/` jest pusty poza README. Stack: Node 24, TypeScript bez budowania, `node:test`, bez zależności. Przeglądarka nie uruchamia `.ts`, a projekt nie ma kroku budowania.
- Eksperyment `agent/experiment/run.ts` prowadzi dwie sesje `claude -p` z `DEVGUIDE_DIR=.devguide/experiment`; `evaluate.ts` zwraca listę `Finding` z werdyktem `tak`/`nie`; kod wyjścia 0 tylko przy komplecie „tak” (dziś osiem).

Zdarzenia zmiany pliku są zapisane w `.devguide/` tylko wtedy, gdy wykonało je narzędzie Claude Code; agent nie zna identyfikatorów zdarzeń hooka bez odczytu `replay --json`.

## Goals / Non-Goals

**Goals:**

- Domknięty przepływ „działanie agenta → zapis zdarzenia → aktualizacja podglądu” bez odświeżania strony i bez nowej zależności.
- Każda informacja w podglądzie ma widoczne pochodzenie: wynik narzędzia, tekst użytkownika, interpretacja AI, zapis DevGuide. Interpretacja nigdy nie jest wyświetlana jako wynik.
- Model widoków liczony w `process/` jako funkcja czysta z listy zdarzeń, testowany bez przeglądarki i bez Claude Code; strona tylko renderuje.
- Rozszerzenie dziennika (`change_explained`, `limits`) zgodne wstecz: stare pliki zadań czytają się bez zmian.

**Non-Goals:**

- Testy w prawdziwej przeglądarce; renderowanie sprawdza test w Node na funkcji zwracającej HTML, a wygląd weryfikacja ręczna.
- Obsługa wielu zadań jednocześnie w jednym oknie; wybór innego zadania to flaga przy uruchomieniu.
- Serwowanie poza `localhost`, uwierzytelnianie, HTTPS.
- Heurystyczne grupowanie zmian plików w poprawki bez objaśnienia agenta.

## Decisions

### D1. Serwer w `process/server.ts` na `node:http`, uruchamiany przez `npm run preview`

`startPreviewServer({ dataDir, port, host: "127.0.0.1", taskId: string | null })` zwraca `{ port, close() }`. `npm run preview` → `node process/server.ts [--port <n>] [--task <id>]`; port domyślny 4310 (`DEVGUIDE_PORT` ze środowiska, flaga ma pierwszeństwo), katalog danych z `resolveDataDir` (`DEVGUIDE_DIR`). Proces wypisuje `Podgląd DevGuide: http://localhost:<port>` i działa do przerwania; zajęty port kończy się komunikatem z podpowiedzią `--port`.

Trasy:

| Trasa | Odpowiedź |
| --- | --- |
| `GET /` | `ui/index.html` |
| `GET /ui/<plik>` | plik z `ui/` z listy dozwolonych nazw (`preview.css`, `preview.js`); każda inna ścieżka 404, bez przejścia poza katalog |
| `GET /api/preview` | JSON `{ task, events, summary, model }` albo `{ task: null, data_dir }` gdy nie ma zadania |
| `GET /api/updates` | strumień Server-Sent Events: zdarzenie `update` z `{ task_id, version }` po każdej wykrytej zmianie, `ping` co 15 s |

Nagłówki `Cache-Control: no-store`; serwer nasłuchuje wyłącznie na `127.0.0.1`. Logika serwera jest w funkcji, żeby test i eksperyment mogły uruchomić ją w procesie na porcie 0 i odczytać przydzielony port.

Alternatywy: WebSocket — wymaga ręcznej implementacji ramek albo zależności, a kanał jest jednokierunkowy; generowanie HTML po stronie serwera — równie testowalne, ale traci stan rozwinięć przy każdej aktualizacji, więc i tak potrzebny byłby skrypt; `process/cli.ts preview` zamiast osobnego pliku — CLI jest narzędziem agenta, serwer narzędziem użytkownika, osobny plik trzyma to rozdzielone.

### D2. Wykrywanie zmian przez odpytywanie `fs.statSync` co 500 ms

Serwer co 500 ms czyta `stat` pliku `current-task` i `tasks/<id>/events.jsonl` oglądanego zadania (rozmiar i `mtimeMs`). Zmiana któregokolwiek powoduje: ponowne ustalenie zadania (gdy podgląd nie jest przypięty flagą `--task` i zmienił się `current-task`), odczyt zdarzeń, zwiększenie licznika `version` i rozesłanie `update` do wszystkich otwartych strumieni. Strona po `update` pobiera `/api/preview`; po `open` strumienia (także po automatycznym ponownym połączeniu `EventSource`, gdy serwer wstał na nowo) również pobiera, więc restart serwera nie wymaga odświeżenia.

Dlaczego nie `fs.watch`: na Windows zgłasza zdarzenia podwójnie i inaczej dla zmiany nazwy, na Linuksie nie jest rekurencyjny w starszych wersjach, a `appendFileSync` jednego wiersza daje zdarzenia o różnej liczbie. Dwa `stat` na pół sekundy to koszt pomijalny, opóźnienie do jednej sekundy mieści się w wymaganiu „w ciągu kilku sekund”. Odczyt pliku zdarzeń następuje tylko po wykryciu zmiany.

### D3. Model widoków w `process/preview-model.ts`: funkcja czysta z zadania i zdarzeń

`buildPreviewModel(task, events)` zwraca:

```text
{
  header:   { description, started, counts (z summarize), hypotheses: {open, confirmed, rejected},
              checks: {current_passed, stale_passed, failed, inconclusive, unverified},
              decisions_unconfirmed, latest_code_version },
  timeline: [{ id, time, origin, sentence, refs: { hypothesis_id?, execution_id?, change_ids? } }],
  steps:    [{ id, kind, time, title, attempt, result, meaning, items: [...], event_ids, claim: boolean }],   // D10
  code:     { cards: [...], unexplained: [...], proposals: [...], diff: [{ path, text }] },
  checks:   { items: [...], unassessed_commands: [{ id, command }] }
}
```

- `timeline` używa `describeEvent` z `replay.ts`; pełne pola zdarzenia strona bierze z listy `events` po `id`, więc model nie dubluje treści. Od rewizji z 2026-10-22 `timeline` jest tylko listą audytową (zwiniętą na dole widoku); główną treścią widoku „Przebieg” są `steps` z D10. Oznaczenia pochodzenia i natury (`illustration` / wynik narzędzia) wynikają z `origin` i `kind`, nie z tekstu.
- `cards`: jedna na `change_explained`: `{ id, title, purpose, mechanism, assumptions, materials, changes: [{ event_id, path, created, before, after, lines, code_version }], unmatched }`, gdzie `lines` to `{ start, end }` z pierwszego hunka `structuredPatch` po stronie „po” albo `null`; `unmatched: true` gdy `change_ids` jest puste.
- `unexplained`: zdarzenia `file_changed`, których nie wskazuje żadne `change_explained`, w kolejności zapisu, tylko pola narzędzia.
- `proposals`: zdarzenia `change_prepared` z tekstem, `patch` i materiałami, oznaczone jako niezastosowane (w tej zmianie model nie próbuje łączyć propozycji z późniejszymi zmianami plików; zrobi to Etap 6 przy zgodzie).
- `diff`: dla każdego pliku (kolejność pierwszego wystąpienia) tekst w formacie unified sklejony z hunków `structuredPatch` wszystkich jego `file_changed` w kolejności zapisu (`@@ -a,b +c,d @@` plus `lines`); nowy plik bez hunków → wszystkie wiersze `after` jako `+`; brak hunków dla istniejącego pliku → blok z `before` jako `-` i `after` jako `+` z nagłówkiem „łatka niedostępna, pokazano fragment przed i po”.
- `checks.items`: `summarize().checks` wzbogacone o `expected`, `evidence`, `limits`, `code_version` wykonania i `changed_since`: ścieżki `file_changed` zapisanych po zdarzeniu wykonania (puste, gdy `current`). `unassessed_commands`: `command_run`, których `id` nie jest `execution_id` żadnego sprawdzenia.

`replay --json` dostaje czwarte pole `model`, to samo, które serwuje serwer, więc dane podglądu da się obejrzeć bez serwera i bez przeglądarki.

Alternatywa: liczyć model w przeglądarce z `events` — nietestowalne w `node:test` bez duplikowania logiki; liczyć w `summarize` — `summarize` zostaje streszczeniem dla CLI i hooka, model widoków jest nad nim.

### D4. Dziennik: `change_explained` i `check.limits`

`events.ts`: nowy rodzaj `change_explained` (`origin: "agent"`): `title`, `purpose`, `mechanism`, `assumptions` (tekst, może być pusty), `materials`, `change_ids: string[]`; `AGENT_KINDS` rozszerzone; `validateDraft` wymaga `title` i `purpose`, `mechanism` opcjonalnie pusty? Nie: `mechanism` wymagany, bo karta bez „jak działa” nie spełnia planu; `assumptions` opcjonalne. `CheckEvent.limits: string | null`, w szkicu opcjonalne; odczyt starych zdarzeń bez pola traktuje je jako `null`.

`appendAgentEvent` dla `change_explained`: gdy szkic ma `change_ids`, każdy musi wskazywać `file_changed` w zadaniu (inaczej `TaskLogError`, nic nie zapisane); gdy nie ma, `change_ids` = identyfikatory `file_changed` o `path` z `files`, zapisanych przed objaśnieniem i nieobecnych w `change_ids` żadnego wcześniejszego `change_explained`. Puste dopasowanie nie jest błędem: zdarzenie zapisuje się z `change_ids: []` i czyta jako objaśnienie bez zarejestrowanej zmiany. Reguła jest symetryczna do dopasowania `check` → `command_run`: po treści (tu: po ścieżce) z jawnym identyfikatorem jako wyjściem awaryjnym.

`cli.ts`: `record change_explained --title --purpose --mechanism [--assumptions] --files a,b [--changes id,id] [--material ...]`; `record check ... [--limits "<tekst>"]`; `HELP` uzupełnione. `replay.ts`: `describeEvent` dla `change_explained` („Objaśniono poprawkę: <tytuł> (zmiany: n)”), `formatEvent` bez zmian (wypisuje wszystkie pola).

Alternatywa: rozszerzyć `change_prepared` o objaśnienie — `change_prepared` to propozycja przed zastosowaniem (Etap 6 rozróżnia propozycję od zmiany zastosowanej), a objaśnienie dotyczy zmian, które narzędzie już zarejestrowało; wiązanie po `files` i czasie bez zapisu `change_ids` — wynik zależałby od chwili odczytu, a zapis ma być samowystarczalny.

### D5. Strona: `ui/index.html`, `ui/preview.css`, `ui/preview.js` jako moduł ES bez budowania

`preview.js` eksportuje czyste funkcje `renderPage(data, state)` → HTML (string) oraz `renderSteps` (widok „Przebieg”: kroki z D10, a pod nimi zwinięte `<details id="all-events">` z dotychczasową płaską listą `renderTimeline`), `renderCode`, `renderChecks`; `state` to `{ view: "przebieg" | "kod" | "sprawdzenia", open: Set<string> }`. Cała treść zdarzeń przechodzi przez `escapeHtml`. Rozwijanie to natywne `<details id="e-<id>">`, więc „kliknięcie pokazuje kontekst” działa bez skryptu; widoki to trzy sekcje przełączane po `location.hash` (`#przebieg`, `#kod`, `#sprawdzenia`). Przed ponownym renderowaniem skrypt zbiera identyfikatory otwartych `<details>` i stan przewinięcia, po nim je przywraca — to spełnia „rozwinięte szczegóły i wybrany widok pozostają”. Uruchomienie w przeglądarce jest w gałęzi `if (typeof document !== "undefined")`, dzięki czemu `ui/preview.test.ts` w Node importuje ten sam plik i sprawdza HTML na modelach z testów (etykiety „wynik narzędzia”, „ilustracja od AI”, „przed poprawką”, „po poprawce”, „bez objaśnienia od AI”, „niezastosowana”, „na wcześniejszej wersji kodu”, brak identyfikatorów poza `<details>`).

Wygląd: ciemny motyw, jeden kolor akcentu dla statusów pozytywnych i aktywnej zakładki, kolor ostrzegawczy tylko dla „niepotwierdzone” i „nieaktualne”, listy z separatorami, monospace dla kodu i wyjść, bez ikon i animacji. Zmienne CSS w `:root`.

Dlaczego JavaScript, nie TypeScript: przeglądarka nie uruchamia `.ts`, a projekt nie ma kroku budowania; plik jest mały, typy modelu są po stronie `process/`. `tsc --noEmit` nie obejmuje `.js` (`allowJs` pozostaje wyłączone), więc test w Node jest jedynym sprawdzeniem tego pliku poza ręcznym.

Alternatywa: framework (Preact, lit) z CDN — zależność sieciowa przy każdym uruchomieniu i sprzeczna z regułą „bez nowej zależności bez uzasadnienia”; HTML liczony na serwerze — patrz D1.

### D6. Eksperyment: jeden krok i jedno pytanie więcej, serwer uruchomiony w procesie

`run.ts`, sesja 1: po kroku `Edit` pliku `hello.txt` i przed sprawdzeniem nowy krok: `node process/cli.ts record change_explained --title "Greeting word" --purpose "..." --mechanism "..." --assumptions "..." --files hello.txt --material "example=hello -> greetings"`. `--allowedTools` bez zmian (`Bash(node process/cli.ts *)` już jest).

Po sesji 2 runner uruchamia `startPreviewServer({ dataDir: ".devguide/experiment", port: 0 })`, pobiera `/api/preview` przez `fetch`, zamyka serwer i przekazuje JSON do `evaluate.ts` jako `preview`. Pytanie 9 („czy podgląd pokazuje kartę poprawki z fragmentem przed/po z narzędzia i objaśnieniem od agenta”): `model.code.cards` ma dokładnie jedną kartę, jej `changes[0]` wskazuje `file_changed` dla `hello.txt` z `before` zawierającym `hello` i `after` zawierającym `greetings`, a `title` to tekst z polecenia; `unexplained` jest puste; `checks.items` zawiera sprawdzenie ze statusem `passed`. Kod wyjścia 0 tylko przy dziewięciu „tak”. Raport dostaje liczbę kart i wiersz z adresem, pod którym serwer odpowiedział.

Alternatywa: wywołać `buildPreviewModel` bez serwera — tańsze o kilka milisekund, ale nie sprawdza trasy, którą idzie przeglądarka.

### D7. Testy bez Claude Code i bez przeglądarki

- `process/events.test.ts`, `task-log.test.ts`: `change_explained` (pięć scenariuszy delty), `limits` (dwa).
- `process/preview-model.test.ts`: karta z jednego `Edit` (fragmenty, `lines` z hunka), karta z dwóch plików, karta `unmatched`, `unexplained` dla zmiany bez objaśnienia, propozycja bez zmian, diff dla dwóch zmian jednego pliku i dla nowego pliku, `changed_since` po `file_changed` z inną wersją kodu, `unassessed_commands`, liczniki nagłówka dla mieszanego stanu, pusta lista zdarzeń.
- `process/server.test.ts`: katalog tymczasowy, `startTask`, serwer na porcie 0; `GET /` zawiera `<title>`, `GET /api/preview` zawiera `model`, `GET /ui/../package.json` → 404, `GET /api/preview` bez zadania → `task: null`; `GET /api/updates` + `appendEvent` → zdarzenie `update` w ciągu 2 s; drugi `startTask` → `update` z nowym `task_id` bez `--task`, bez `update` zmiany zadania z `--task` pierwszego.
- `ui/preview.test.ts`: jak w D5.
- `agent/experiment/run.test.ts`: komplet dowodów → dziewięć „tak”; brak karty → „nie”; karta bez `after` z `greetings` → „nie”.
- `process/cli.test.ts`: `record change_explained` bez `--title` → kod 1; pełna ścieżka `Edit`-podobne zdarzenie przez `recordHookEvent` → `record change_explained --files` → `replay --json` ma `model.code.cards[0].changes[0].event_id` równe identyfikatorowi zmiany.

### D10. Kroki zadania: deterministyczne grupowanie zdarzeń w `preview-model.ts`

Rewizja po teście z 2026-10-22: płaska lista zdarzeń czytała się jak log. `buildSteps(events, summary)` zwraca listę kroków `{ id, kind, time, title, attempt, result, meaning, items, event_ids, claim }`. Reguły, wszystkie wyliczane z danych dziennika, bez heurystyk na tekście:

| Kotwica kroku | `kind` | `attempt` (co próbowano) | `result` (co wyszło) | `meaning` (co to znaczy) |
| --- | --- | --- | --- | --- |
| `user_prompt` | `user` | tekst użytkownika | — | — |
| `observation` | `observation` | tekst | materiały (ilustracja od AI) | — |
| `hypothesis` | `hypothesis` | tekst | — | stan z `summarize`: otwarta / potwierdzona / odrzucona z powodem |
| `hypothesis_resolved` | `resolution` | tekst rozstrzygnięcia | — | „potwierdza/odrzuca przypuszczenie: <tekst hipotezy>” z odnośnikiem |
| `proposal` | `proposal` | tekst | materiały | — |
| `change_prepared` | `prepared` | tekst | łatka | „przygotowana, niezastosowana” |
| `change_explained` + jego `file_changed` | `change` | tytuł i cel | fragmenty przed/po z każdej zmiany (narzędzie) | mechanizm, założenia; przy pustym `change_ids` „brak zarejestrowanej zmiany pliku” |
| `check` + jego `command_run` | `check` | `what`, `expected` | status, cytat dowodu, pierwsze wiersze wyjścia wykonania | aktualne → „potwierdza bieżący kod”; nieaktualne → „kod zmienił się od tego czasu: <pliki>”; `unverified` → „deklaracja AI bez dowodu: <powód>”; `failed` → „nie przeszło”; `limits` jako ograniczenia |
| `decision` | `decision` | pytanie | cytat | potwierdzona cytatem / niepotwierdzona |
| ciąg nieprzypisanych zdarzeń narzędzi | `tools` | zdanie zliczające („zmieniono 1 plik, uruchomiono 3 polecenia”) | po jednym elemencie na zdarzenie: ścieżka z przed/po albo pierwsze wiersze wyjścia albo błąd narzędzia | „AI nie zapisało, po co to zrobiło” (bo nie ma objaśnienia ani sprawdzenia) |
| `agent_message` | `claim` | tekst komunikatu | — | „wypowiedź AI; wykonanie potwierdzają tylko wyniki narzędzi i sprawdzeń” |
| `session_resumed` | `session` | „wznowiono sesję” | — | — |

Przypisanie zdarzeń narzędzi: `check.execution_id` i `change_explained.change_ids` zabierają swoje zdarzenia (pierwszy, który je wskazuje, wygrywa). Pozostałe zdarzenia narzędzi idą do bieżącego kroku `tools`, który zamyka każde zdarzenie innego rodzaju. Czas kroku to czas jego najwcześniejszego zdarzenia; lista jest posortowana po nim, więc objaśnienie zapisane po zmianach stoi tam, gdzie zmiany. `task_started` nie jest krokiem (to nagłówek). `items` zawiera konkretne dane do pokazania w głównej treści: `{ event_id, kind: "file" | "output" | "error" | "material" | "evidence", label, path?, before?, after?, lines?, excerpt?, truncated, nature }`; wycinek wyjścia to pierwsze 5 wierszy (`truncated: true` gdy jest więcej), pełne wyjście strona bierze z `events`. Surowe polecenia, czasy, pochodzenie, identyfikatory i wersja kodu nie są polami kroku: strona składa „Szczegóły” z `event_ids` i listy `events`.

Nagłówek i inne widoki bez zmian. Alternatywa: grupować po czasie (okna kilku sekund) — zależne od szybkości modelu i mylące przy wznowieniach; grupować po pliku — rozbija sprawdzenia od zmian, które sprawdzają.

### D11. Układ według makiety: historia kroków i widok kroku (zastępuje listę z D10 i część D5)

Rewizja po drugim teście z 2026-10-22, ze zrzutem makiety jako wzorcem. Model kroku z D10 zostaje jako baza, ale zmieniają się reguły kotwic i to, co strona z nich robi.

**Kotwice kroków** (`buildSteps`): `task_started` („Zgłoszono zadanie”), `observation`, `hypothesis`, `hypothesis_resolved`, `proposal`, `change_prepared`, `change_explained` (ze swoimi zmianami), `check` (ze swoim wykonaniem), `decision` oraz ciąg kolejnych nieprzypisanych `file_changed` („Zmieniono plik X” / „Zmieniono 2 pliki”, podtytuł „bez objaśnienia od AI”). `command_run`, `tool_failed`, `agent_message`, `user_prompt` i `session_resumed` nie są krokami: trafiają do `sources` kroku, którego kotwica jest następna w czasie, a gdy takiej nie ma, do ostatniego kroku. Krok ma `time` swojej kotwicy (zmiana z objaśnieniem: czas pierwszej zmiany), a lista jest posortowana po `time`.

**Pola kroku**: `{ id, kind, time, title, subtitle, kicker, lead, blocks, sources, decision, code_link }`:

- `title` krótki, w stylu zdarzenia: tekst ustalenia przycięty do ok. 70 znaków, a dla rodzajów bez tekstu stały („Odrzucono podejrzenie”, „Przygotowano poprawkę”, „Decyzja użytkownika”, „Zmieniono plik X”);
- `subtitle` jedno krótkie określenie stanu: „Obserwacja · 1 przykład”, „Podejrzenie · odrzucone”, „Sprawdzenie · przeszło”, „Oczekuje na decyzję (demonstracja)”, „Bez objaśnienia od AI”;
- `kicker` linia nad tytułem w widoku kroku: rodzaj i powiązanie z kodem, np. „Propozycja · pliki jeszcze bez zmian”, „Zmiana w kodzie · 2 fragmenty · po poprawce”;
- `lead` jedno lub dwa zdania wyjaśnienia (treść ustalenia; dla zmiany cel; dla sprawdzenia oczekiwanie; dla zgłoszenia opis zadania; dla kroku bez ustaleń zdanie „AI nie zapisało żadnych ustaleń w tym zadaniu”);
- `blocks` tylko potrzebne elementy, w kolejności: `example` (materiały od AI z podpisem „Przykład od AI. Nie jest wynikiem sprawdzenia.”), `diff` (fragmenty przed/po z narzędzia), `patch` (łatka propozycji), `check` (status, dowód, wycinek wyjścia, ograniczenia, dezaktualizacja), `hypothesis_state`, `decision_record` (pytanie, cytat, odczyt, potwierdzenie), `missing` (zdanie o brakującej informacji, np. „Nie zarejestrowano wykonania polecenia”);
- `sources` lista zdarzeń kroku z pełnymi danymi do rozwijanego panelu „Źródła”: dla każdego czas, pochodzenie, rodzaj, identyfikator, wersja kodu, a dla `command_run` polecenie i wyjścia, dla `agent_message` i `user_prompt` tekst;
- `decision` tylko dla `change_prepared` bez późniejszych `file_changed` o tych samych plikach: `{ demo: true, applied: false }`, strona rysuje przyciski z podpisem „Demonstracja: sterowanie agentem podłączy Etap 6; przyciski niczego nie zmieniają”;
- `code_link` dla kroków zmiany: identyfikator karty w „Kodzie AI” i liczba fragmentów.

**Nagłówek** (`header`): `repo` (nazwa katalogu nad katalogiem danych, z serwera), `task_id`, `title` (opis zadania przycięty do pierwszego zdania lub 90 znaków), `goal` (pełny opis, gdy dłuższy), `status_line` jedno zdanie z priorytetem: propozycja czeka na decyzję → sprawdzenia potwierdzające bieżący kod → sprawdzenia niepotwierdzone lub nieaktualne → odrzucone podejrzenia → „w toku, bez sprawdzeń”; żadnych zer. `chip` po prawej: „Aktualizuje się na bieżąco” albo „Przypięte do zadania”.

**Strona** (`preview.js`): `renderPage` buduje nagłówek, zakładki i dla „Przebiegu” `<div class="layout">` z `<nav class="history">` (lista `<a href="#przebieg/<id>">` z czasem, tytułem, podtytułem, klasa `selected`) i `<section class="step-view">` z `renderStepView(step)`. Stan: `view`, `step` (z hasha `#przebieg/<id>`), `pinned` (czy użytkownik wybrał krok ręcznie; bez tego wybrany jest najnowszy, więc podgląd „idzie” za zadaniem), `open` (rozwinięte `<details>`). Poniżej 900 px układ jest jednokolumnowy: historia, a pod nią widok kroku z odsyłaczem „← Kroki” przewijającym do listy. Zakładki „Kod AI” i „Wyniki sprawdzeń” zostają, bez legend i liczników zerowych. Płaska lista zdarzeń znika ze strony (zostaje w CLI `replay`). Stopka: „Dane z dziennika zadania w <katalog>. Przyciski decyzji są demonstracją.”

Alternatywa: zostawić listę numerowaną z D10 i dodać tylko kolumnę szczegółów — nie spełnia punktów 2 i 5 opinii (polecenia jako kroki, nagłówki zliczające), więc kotwice muszą się zmienić.

### D12. Treść przebiegu: kroki odtworzone z narzędzi, stan wykonania, sprawdzenia przy zmianie

Rewizja po trzecim teście (2026-10-27). Przyczyna braku ustaleń w sesji użytkownika, ustalona z dziennika: skill `/devguide` z Etapu 2 mówi agentowi „you do not need to describe your actions” i nie wspomina o `process/cli.ts record`; agent użył wyłącznie Bash (trzy `PostToolUse` Bash, zero Write/Edit), więc dziennik dostał same `command_run`. Zapis (CLI) i odczyt (model, strona) działają: eksperyment potwierdza 9/9. Zapis ustaleń przez agenta w trakcie pracy wprowadza zmiana `stage-5-guiding-skill`; tu poprawiamy to, co podgląd robi z tym, co ma.

- **Kroki odtworzone z narzędzi** (`buildSteps`): gdy zadanie nie ma żadnego ustalenia agenta, każde `command_run` i `tool_failed` staje się krokiem `tool_run`: `title` = „Polecenie na <plik>” gdy z treści polecenia da się odczytać ścieżkę (token z `/` lub z rozszerzeniem, niebędący flagą, z pierwszeństwem dla ścieżek z `files` zadania), inaczej „Polecenie”; `subtitle` = „wyjście: „<pierwszy wiersz do 40 znaków>”” albo „bez wyjścia” albo „błąd narzędzia”; `lead` = „AI uruchomiło polecenie; nie zapisało, po co ani co miało z tego wynikać.”; `blocks` = wycinek wyjścia (`output`) jako wynik narzędzia; treść polecenia tylko w `sources`. `file_changed` bez objaśnienia pozostaje krokiem `unexplained_change`. Gdy zadanie ma choć jedno ustalenie, obowiązuje D11 (polecenia jako źródła następnego kroku), więc po pierwszym ustaleniu historia zwija kroki poleceń do źródeł. Notka „AI nie zapisało żadnych ustaleń” zostaje w kroku zadania.
- **Stan wykonania i weryfikacji** (`header`): `execution` z ostatniego zdarzenia: `session_ended` → „Sesja zakończona”; `agent_message` → „Agent zakończył turę i czeka na odpowiedź”; inne → „Agent pracuje”. `verification` = zdanie o sprawdzeniach bez zer albo „brak zapisanych sprawdzeń”. `status_line` = decyzja w toku ? jak dotąd : `${execution} · ${verification}`; nigdy „w toku” jako domysł. Hook: `SessionEnd` przy otwartym zadaniu zapisuje `session_ended` (`origin: devguide`, `reason`), analogicznie do `session_resumed`.
- **Sprawdzenia przy zmianie**: krok `change` i `unexplained_change` dostaje `checks_after: [{ step_id, title, status_text, tone }]` ze sprawdzeń zapisanych po czasie zmiany; strona pokazuje listę „Sprawdzenia po tej zmianie” z odsyłaczami, a bez nich zdanie „Po tej zmianie nie zapisano żadnego sprawdzenia.” To chronologia, nie twierdzenie o związku przyczynowym; etykieta mówi „po tej zmianie”.
- **Widok sprawdzeń**: sekcja „Polecenia uruchomione bez oceny” znika (`unassessed_commands` zostaje w modelu dla `replay --json`); zakładka „Wyniki sprawdzeń” jest renderowana tylko, gdy `checks.items.length > 0`; analogicznie zakładka „Kod AI” tylko, gdy są karty, zmiany bez objaśnienia albo propozycje.

## Risks / Trade-offs

- [Opóźnienie do ~1 s między zapisem a aktualizacją] → akceptowalne wobec wymagania „kilka sekund”; interwał jest stałą w jednym miejscu.
- [Duże wyjścia poleceń w `events` spowalniają stronę] → zdania w przebiegu są przycięte, pełna treść jest w zamkniętych `<details>`; jedno zadanie to setki zdarzeń, nie tysiące; jeśli to przestanie wystarczać, `/api/preview` dostanie parametr pomijający pełne wyjścia.
- [Treść zdarzeń zawiera HTML lub skrypt] → każde pole przechodzi przez `escapeHtml`; test sprawdza, że `<script>` w tekście obserwacji nie trafia do HTML bez zamiany.
- [`structuredPatch` ma inny kształt w innej wersji Claude Code] → model sprawdza kształt hunków i przy niezgodności używa `before`/`after` z nagłówkiem o niedostępnej łatce; nic nie pada.
- [Agent wiąże objaśnienie z niewłaściwymi zmianami, bo zmienił plik kilka razy] → reguła „zmiany nieobjęte wcześniejszym objaśnieniem” plus `--changes` jako jawne wskazanie; karta pokazuje każdą powiązaną zmianę z czasem, więc pomyłka jest widoczna, nie ukryta.
- [`change_prepared` pokazane jako „niezastosowana” choć agent potem zmienił plik ręcznie tą samą treścią] → w tej zmianie świadomie bez łączenia; Etap 6 wprowadzi zgodę na konkretną zawartość i wtedy powiązanie.
- [Port 4310 zajęty] → komunikat z podpowiedzią `--port`; `DEVGUIDE_PORT` dla stałej konfiguracji.
- [Zadanie bez ustaleń agenta ma w historii tylko „Zgłoszono zadanie”] → to uczciwy obraz dziennika bez skillu z Etapu 5; widok kroku mówi wprost, że AI nie zapisało ustaleń, a polecenia są w źródłach; zmiany plików narzędziami Write/Edit nadal dają kroki „Zmieniono plik”.
- [Przyciski decyzji mogą sugerować działającą kontrolę] → podpis „Demonstracja” przy przyciskach, brak obsługi kliknięcia, zdanie w stopce; Etap 6 podłączy je do hooka.
- [Zmiana pliku przez Bash (`sed`, `printf`) nie jest `file_changed`] → krok pokazuje tylko wyjście polecenia; ograniczenie zapisane w `docs/local-preview.md`, skill Etapu 5 ma kazać używać Write/Edit.
- [Koszt eksperymentu rośnie o jedną turę] → ok. 0,05 USD; eksperyment i tak nie jest częścią `npm run check`.
- [Zmiana `stage-3-task-event-log` niezarchiwizowana, delta `task-event-log` dodaje do niej wymagania] → delta zawiera tylko ADDED; archiwizacja Etapu 3 przed archiwizacją tej zmiany zapisana w tasks.md jako krok workflow.

## Open Questions

- Czy podgląd ma sam otwierać przeglądarkę (`--open`)? Nie zmienia specyfikacji ani zadań; w tej zmianie polecenie tylko wypisuje adres.
