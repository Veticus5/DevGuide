# Design

## Context

Motywacja: `proposal.md` — Why. Wymagania: `specs/task-event-log`, `specs/task-replay`.

Stan repozytorium: hook `agent/hooks/record-event.ts` dopisuje surowe wpisy hooków do `.devguide/events.jsonl` (lub pliku z `DEVGUIDE_LOG_FILE`), rozpoznaje `/devguide` w `UserPromptSubmit` i blokuje polecenie ze znacznikiem. `process/` jest pusty. Eksperyment `agent/experiment/run.ts` uruchamia dwie sesje `claude -p` z hookami z `agent/experiment/settings.json` i ocenia dziennik w `evaluate.ts`.

Fakty, na których opiera się projekt (`docs/claude-code-integration.md`, Claude Code 2.1.300):

- `PostToolUse` dla `Write` daje `filePath`, `type`, `content`, `originalFile`; dla `Edit` `filePath`, `oldString`, `newString`, `structuredPatch`; dla `Bash` `stdout`, `stderr`, `interrupted`, bez kodu wyjścia.
- `UserPromptSubmit` daje surowy `prompt`; `Stop` daje `last_assistant_message`; `SessionStart` daje `source` (`startup`, `resume`).
- Hooki i polecenia agenta (narzędzie Bash) działają w katalogu sesji, czyli w katalogu repozytorium, i dziedziczą zmienne środowiskowe procesu `claude`.
- Niepotwierdzone, do rozstrzygnięcia eksperymentem: `additionalContext` w odpowiedzi hooka `SessionStart`; kształt `PostToolUseFailure`.

Zmiany agenta w trakcie zadania są niezatwierdzone w Git, więc sam commit nie identyfikuje wersji kodu, na której wykonano sprawdzenie.

## Goals / Non-Goals

**Goals:**

- Jeden plik zdarzeń na zadanie, dopisywany na końcu, czytelny zwykłym `cat`, z jednym modelem zdarzeń dzielonym przez hook, CLI agenta, odczyt i (w Etapie 4) podgląd.
- Reguły „status sprawdzenia wymaga wykonania i dowodu” oraz „decyzja wymaga cytatu z wypowiedzi użytkownika” egzekwowane w kodzie zapisu, testowane bez Claude Code.
- Hook pozostaje tani: odcisk drzewa roboczego liczony tylko, gdy powstaje zdarzenie zadania.
- Każde nowe założenie o Claude Code (`additionalContext`) potwierdzone przez `npm run experiment`.

**Non-Goals:**

- Interpretowanie zmian plików w logiczne poprawki z objaśnieniami (Etap 4) i egzekwowanie zgody przed zastosowaniem (Etap 6).
- Obserwowanie zmian plików wykonanych poza narzędziami Claude Code (np. ręczna edycja przez użytkownika); odcisk drzewa je wykryje jako „inna wersja kodu”, ale nie zapisze, co się zmieniło.
- Współbieżność: jedno zadanie naraz, jedna sesja pisząca naraz; brak blokad plików.

## Decisions

### D1. Model zdarzeń w `process/events.ts`, jeden plik JSONL na zadanie

Wspólna koperta: `id` (8 znaków hex z `crypto.randomBytes`), `time` (ISO 8601), `task_id`, `session_id` (lub `null`), `origin` (`user` | `tool` | `agent` | `devguide`), `code_version` (`{ commit: string | null, working_tree: string | null }`), `files: string[]`, `kind` i pola rodzaju. Rodzaje i pola:

| `kind` | `origin` | Pola |
| --- | --- | --- |
| `task_started` | `user` | `description` |
| `user_prompt` | `user` | `text` |
| `session_resumed` | `devguide` | `source` (`resume`, `startup`, inne z `SessionStart`) |
| `observation` | `agent` | `text`, `materials` |
| `hypothesis` | `agent` | `text` |
| `hypothesis_resolved` | `agent` | `hypothesis_id`, `outcome` (`confirmed` \| `rejected`), `text` |
| `proposal` | `agent` | `text`, `materials` |
| `change_prepared` | `agent` | `text`, `patch` (opcjonalny tekst), `materials` |
| `file_changed` | `tool` | `path`, `created`, `before`, `after`, `patch` (z `structuredPatch`, gdy jest), `tool` |
| `command_run` | `tool` | `command`, `stdout`, `stderr`, `interrupted`, `exit_code: null` |
| `tool_failed` | `tool` | `tool`, `input`, `error` |
| `decision` | `agent` | `question`, `quote`, `reading`, `confirmed: boolean`, `prompt_event_id` \| `null` |
| `check` | `agent` | `what`, `expected`, `command`, `evidence`, `claimed` (`passed` \| `failed` \| `inconclusive`), `status` (`passed` \| `failed` \| `inconclusive` \| `unverified`), `execution_id` \| `null`, `reason` \| `null` |
| `agent_message` | `agent` | `text` |

`materials`: lista `{ label, content, nature }`, gdzie `nature` to `illustration` dla wszystkiego z CLI; `observed` jest zarezerwowane dla odczytu, który pokazuje wyjścia poleceń jako rzeczywiste wyniki. Typy są wyrażone jako unia dyskryminowana po `kind` (bez `enum`, zgodnie z `erasableSyntaxOnly`).

Plik: `.devguide/tasks/<task_id>/events.jsonl`, jeden wiersz na zdarzenie, dopisywany `appendFileSync`. Obok `task.json` z `id`, `description`, `started`, `session_ids`. Plik `.devguide/current-task` zawiera identyfikator otwartego zadania; `/devguide` go nadpisuje. `task_id` to `<data>-<4 znaki hex>` (np. `20261021-1532-a1f3`), żeby katalogi sortowały się chronologicznie i nie myliły z identyfikatorem sesji, który zadanie może dzielić z wieloma wznowieniami.

Alternatywy: SQLite przez `node:sqlite` — odczyt w Etapie 4 będzie chciał filtrować, ale rozmiar jednego zadania to setki wierszy, a JSONL da się czytać bez narzędzi; projekcja z surowego dziennika zamiast osobnego pliku — nie ma gdzie dopisywać ustaleń agenta i wymaga interpretacji surowych ładunków przy każdym odczycie.

### D2. Katalog danych wskazuje `DEVGUIDE_DIR`, surowy dziennik zostaje

`process/paths.ts` rozwiązuje katalog danych: `DEVGUIDE_DIR` ze środowiska, inaczej `<cwd>/.devguide`. Surowy dziennik hooków to `<katalog>/events.jsonl`, zadania w `<katalog>/tasks/`. Zmienna zastępuje `DEVGUIDE_LOG_FILE`, bo hook i CLI agenta muszą trafić w ten sam katalog, a obie strony dziedziczą środowisko procesu `claude`. Eksperyment ustawia `DEVGUIDE_DIR=.devguide/experiment`. Surowy dziennik pozostaje pełnym śladem (specyfikacja `agent-activity-log`), a zdarzenia zadania przechowują tylko to, co potrzebne do odtworzenia.

### D3. Hook deleguje do `process/`, nie odwrotnie

`agent/hooks/record-event.ts` po zapisaniu surowego wpisu wywołuje `recordHookEvent(input, dir)` z `process/task-log.ts`, które: dla `UserPromptSubmit` z `/devguide` tworzy zadanie i zdarzenie `task_started`; dla innego `UserPromptSubmit` przy otwartym zadaniu dopisuje `user_prompt`; dla `PostToolUse` `Write`/`Edit` dopisuje `file_changed`, dla `Bash` `command_run` (pomijając polecenia zawierające `process/cli.ts record`, bo zapisem jest samo ustalenie), dla `PostToolUseFailure` `tool_failed`; dla `Stop` `agent_message`; dla `SessionStart` przy otwartym zadaniu `session_resumed` i zwraca tekst kontekstu. Każde inne zdarzenie i każde zdarzenie bez otwartego zadania nie tworzy nic. Błędy są łapane i wypisywane na stderr; hook zawsze kończy się kodem 0 (poza blokadą, która jest niezmieniona).

Kierunek zależności: `process/` nie importuje nic z `agent/`; `agent/` importuje `process/`. Dzięki temu Etap 4 (serwer, podgląd) czyta ten sam moduł, a hook pozostaje cienkim adapterem Claude Code.

Alternatywa: hook pisze tylko surowo, a osobny proces w tle obserwuje plik i deriwuje zdarzenia — wprowadza drugi proces i opóźnienie bez korzyści na tym etapie.

### D4. Wersja kodu to commit plus odcisk drzewa roboczego

`process/code-version.ts` zwraca `{ commit, working_tree }`: `commit` z `git rev-parse HEAD`; `working_tree` to SHA-256 z połączenia `git diff HEAD --no-color --no-ext-diff` (zmiany śledzonych plików, zatwierdzone w indeksie lub nie) oraz listy nieśledzonych, nieignorowanych plików (`git ls-files --others --exclude-standard`) z ich hashami treści (`git hash-object --stdin-paths`, jedno wywołanie). Katalog `.devguide/` jest ignorowany, więc nie wpływa na odcisk. Poza repozytorium Git oba pola to `null`.

Odcisk jest liczony raz na wywołanie hooka i tylko wtedy, gdy powstaje zdarzenie zadania (dla `PreToolUse` i `PostToolUse` narzędzi odczytu nie powstaje nic, więc nie ma kosztu). Eksperyment mierzy narzut: czas sesji 1 porównany z wynikiem Etapu 2 (9275 ms) i zapisany w `docs/task-event-log.md`.

Alternatywa: licznik zdarzeń `file_changed` zamiast odcisku — tańsze, ale ślepe na zmiany spoza narzędzi Claude Code i na przywrócenie pliku do poprzedniej treści. `git stash create` — tworzy obiekty w repozytorium użytkownika przy każdym zdarzeniu.

### D5. Reguły statusów egzekwuje funkcja zapisu, nie CLI

`process/task-log.ts` ma `appendAgentEvent(task, draft)`, która przed dopisaniem: dla `check` szuka w zadaniu ostatniego `command_run` o identycznej treści `command` (po przycięciu białych znaków), sprawdza, czy `evidence` występuje w `stdout + stderr`, i ustala `status`: `passed`/`failed`/`inconclusive` zgodnie z `claimed`, gdy wykonanie istnieje i dowód (niepusty) się znalazł; `unverified` z `reason` w pozostałych przypadkach (`no_execution`, `evidence_not_found`, `no_evidence`). Dla `decision` szuka `quote` w zdarzeniach `user_prompt` i `task_started` zadania i ustawia `confirmed` oraz `prompt_event_id`. Dla `hypothesis_resolved` sprawdza istnienie hipotezy i odrzuca zapis błędem. Zapis z `unverified` lub `confirmed: false` nie jest błędem: historia ma zawierać również nieudane próby, a odczyt pokazuje je jako niepotwierdzone.

Dopasowanie polecenia po treści, nie po identyfikatorze, bo agent nie zna identyfikatorów zdarzeń z hooków, a treść polecenia pisze sam w obu miejscach. Opcjonalny `--execution <id>` pozwala wskazać wykonanie wprost (np. po odczycie `replay --json`).

Alternatywa: egzekwowanie w skillu („nie pisz passed bez dowodu”) — to instrukcja w prompcie, której plan zabrania traktować jako mechanizm.

### D6. CLI agenta: `node process/cli.ts record <kind> [opcje]`, flagi przez `node:util` `parseArgs`

Podpolecenia: `record observation|hypothesis|resolve|proposal|change|decision|check`, `replay [--json] [--event <id>]`, `status`. Flagi tekstowe: `--text`, `--files a,b`, `--material "etykieta=treść"` (powtarzalna), `--material-file "etykieta=ścieżka"`; dla `resolve`: `--hypothesis <id> --outcome confirmed|rejected`; dla `decision`: `--question --quote --reading`; dla `check`: `--what --expected --command --evidence --claimed`. CLI wypisuje `recorded <kind> <id>` i kończy się kodem 1 z komunikatem po angielsku (jak reszta narzędzi deweloperskich) przy braku zadania lub pola. Tekst `replay` i `status` jest po polsku, bo to zalążek podglądu dla użytkownika; Etap 4 przejmie te same formatery.

Polecenie zapisu widać w surowym dzienniku (`PostToolUse` dla `Bash`), więc pochodzenie każdego ustalenia da się zweryfikować czasem i treścią wywołania; w zadaniu nie powstaje `command_run`, żeby przebieg nie dublował każdego ustalenia.

Alternatywa: JSON na stdin — odporniejsze na cudzysłowy, ale mniej czytelne w surowym dzienniku i trudniejsze do poprawnego wygenerowania przez agenta w jednym wierszu; plik w `.devguide/inbox/` zbierany przez hook — pośrednie i opóźnione.

### D7. Odczyt: `process/replay.ts` buduje stan i tekst z listy zdarzeń

Funkcje czyste: `summarize(events)` → `{ task, hypotheses: [{ id, text, status, resolution }], checks: [{ id, what, status, current: boolean, reason }], decisions, counts }`; `formatTimeline(events)` i `formatSummary(summary)` → tekst po polsku, jedno zdanie na zdarzenie z prefiksem pochodzenia (`[użytkownik]`, `[narzędzie]`, `[AI]`, `[DevGuide]`), identyfikator na końcu wiersza w nawiasie; `--event <id>` wypisuje pełne pola jednego zdarzenia. `current` sprawdzenia to równość `code_version` zdarzenia `command_run` z ostatnim niepustym `code_version` w zadaniu. Kontekst dla `SessionStart` to `formatSummary` skrócone do kilku linii plus zdanie „Run `node process/cli.ts replay` for the full course” (po angielsku, bo odbiorcą jest agent).

### D8. Kontekst zadania przez `additionalContext` w `SessionStart`, potwierdzany eksperymentem

Hook dla `SessionStart` przy otwartym zadaniu wypisuje `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"<kontekst>"}}`. Eksperyment sprawdza, że agent w sesji 2 (wznowionej) podaje identyfikator zadania, którego nie widział w sesji 1: CLI wypisuje tylko identyfikatory zdarzeń, a identyfikator zadania zna tylko hook. Jeśli test da „nie”, dziennik i `replay` działają niezależnie, a wariantem jest instrukcja w skillu Etapu 5, by zaczynać od `replay`; wynik trafia do `docs/claude-code-integration.md`.

### D9. Eksperyment rozszerzony o kroki Etapu 3 w tych samych dwóch sesjach

`agent/experiment/run.ts`: sesja 1 dostaje po dotychczasowych krokach trzy nowe: zapis obserwacji z materiałem, zapis hipotezy, zapis sprawdzenia dla `echo devguide-ok` z dowodem `devguide-ok` i `--claimed passed`; `--allowedTools` dodaje `Bash(node process/cli.ts *)`. Sesja 2 pyta o słowo-klucz i o identyfikator zadania DevGuide (dwa pytania, odpowiedź w dwóch wierszach). `evaluate.ts` dostaje trzy nowe pytania: „czy ustalenia agenta trafiają do zadania” (zdarzenia `observation`, `hypothesis`, `check` ze statusem `passed` i `execution_id` wskazującym `command_run` z `devguide-ok`), „czy zdarzenia narzędzi są w zadaniu” (`file_changed` dla `hello.txt` z `before`/`after` z `Edit`, `command_run` z `devguide-ok`, brak `command_run` dla wywołań CLI), „czy agent dostaje kontekst po wznowieniu” (`session_resumed` w zadaniu i identyfikator zadania w odpowiedzi sesji 2). Raport wypisuje narzut czasu i liczbę zdarzeń zadania. Kod wyjścia 0 tylko przy ośmiu „tak”.

Alternatywa: osobny skrypt dla Etapu 3 — druga para sesji, dwukrotny koszt, a kroki i tak potrzebują hooków i wznowienia z Etapu 2.

### D10. Testy bez Claude Code

- `process/events.test.ts`: walidacja szkiców zdarzeń (wymagane pola per `kind`).
- `process/task-log.test.ts`: katalog tymczasowy, `DEVGUIDE_DIR`; start zadania, drugie zadanie, zdarzenia z przykładowych wejść hooków w kształtach z `docs/claude-code-integration.md` (`Write`, `Edit`, `Bash`, `Stop`, `UserPromptSubmit`, `SessionStart`), pominięcie `Bash` z `process/cli.ts record`, brak zadania → brak zdarzeń; reguły `check` (cztery scenariusze specyfikacji), `decision` (dwa), `hypothesis_resolved` (błąd przy nieistniejącej).
- `process/code-version.test.ts`: repozytorium tymczasowe z `git init`; ten sam odcisk bez zmian, inny po zmianie pliku, inny po dodaniu nieśledzonego pliku, `null` poza repozytorium.
- `process/replay.test.ts`: podsumowanie z odrzuconą hipotezą, `current: false` po `file_changed` z innym `code_version`, JSON zgodny z tekstem, pusty dziennik.
- `process/cli.test.ts`: proces potomny; `record` bez zadania → kod 1; `record hypothesis` bez `--text` → kod 1; pełna ścieżka `record` → `replay --json` zawiera zdarzenie.
- `agent/hooks/record-event.test.ts`: rozszerzony o `UserPromptSubmit` `/devguide` tworzący zadanie, `PostToolUse` `Edit` dający `file_changed`, `SessionStart` z otwartym zadaniem → `additionalContext` na stdout, niezapisywalny katalog zadań → kod 0 i stderr.

## Risks / Trade-offs

- [`additionalContext` w `SessionStart` nie działa lub działa inaczej w `-p`] → eksperyment daje „nie” dla jednego pytania; dziennik i odczyt nie zależą od niego; wariant w D8.
- [Odcisk drzewa roboczego spowalnia hook w dużym repozytorium] → liczony tylko przy zdarzeniach zadania; eksperyment mierzy narzut; jeśli przekroczy ok. 300 ms na zdarzenie, Etap 4 rozważy ograniczenie `git diff` do plików z `file_changed` w zadaniu.
- [Agent zapisuje `check` z poleceniem w innym brzmieniu niż uruchomił (np. z `cd` na początku)] → status `unverified` z powodem `no_execution` zamiast fałszywego `passed`; skill Etapu 5 dostanie instrukcję kopiowania polecenia dosłownie; `--execution <id>` jako wyjście awaryjne.
- [Dowód to krótki tekst, który przypadkiem występuje w wyjściu] → reguła wymaga niepustego dowodu, nie ocenia jego trafności; plan zakłada, że to użytkownik ocenia dowód, a dziennik gwarantuje tylko, że dowód pochodzi z rzeczywistego wyjścia.
- [`PostToolUseFailure` ma inny kształt niż `error`] → `tool_failed` zapisuje cały ładunek w `input`/`error` tak, jak przyszedł; kształt odnotowany w dokumencie ustaleń, gdy eksperyment go zobaczy (celowo nie wywołujemy błędu w eksperymencie, żeby nie podnosić kosztu).
- [`UserPromptSubmit` dla `/devguide` w trakcie otwartego zadania zamyka je bez ostrzeżenia] → zamierzone w pierwszej wersji (jedno zadanie naraz); poprzednie zadanie zostaje na dysku; `status` wypisuje identyfikator bieżącego.
- [Dwie sesje piszące do tego samego zadania jednocześnie] → poza zakresem (jeden użytkownik, jedna sesja); `appendFileSync` pojedynczych wierszy ogranicza szkody do przeplotu, nie utraty.
- [Zmiana `DEVGUIDE_LOG_FILE` na `DEVGUIDE_DIR` łamie czyjeś użycie] → jedynym użytkownikiem jest eksperyment w tym repozytorium; dokumentacja opisuje nową zmienną.

## Open Questions

- Czy w Etapie 4 kontekst dla agenta powinien być również wstrzykiwany po kompaktowaniu kontekstu (`SessionStart` z `source: compact`)? Hook już dopisuje `session_resumed` z dowolnym `source`; decyzja o treści kontekstu nie zmienia tej zmiany.
