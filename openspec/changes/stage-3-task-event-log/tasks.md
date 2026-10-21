# Tasks

## 1. Model zdarzeń i katalog danych

- [x] 1.1 Napisać `process/events.ts`: typy koperty zdarzenia i unia rodzajów z design D1 (bez `enum`), funkcja `validateDraft(kind, fields)` zwracająca listę brakujących lub niepoprawnych pól oraz `newEventId()`; zweryfikować przez `process/events.test.ts` (każdy rodzaj: komplet pól przechodzi, brak pola wymaganego zgłasza jego nazwę; `claimed` spoza listy odrzucone) i `npm run check:types`.
- [x] 1.2 Napisać `process/paths.ts`: `resolveDataDir(env, cwd)` (`DEVGUIDE_DIR` albo `<cwd>/.devguide`), ścieżki surowego dziennika, katalogu zadań, pliku `current-task`, katalogu i plików jednego zadania; zweryfikować testem w `process/paths.test.ts` (zmienna wygrywa, domyślna ścieżka względem `cwd`) i tym, że `.gitignore` nadal obejmuje `.devguide/` (`git check-ignore .devguide/tasks/x/events.jsonl` wypisuje ścieżkę).

## 2. Wersja kodu

- [x] 2.1 Napisać `process/code-version.ts` zgodnie z design D4: `readCodeVersion(cwd)` → `{ commit, working_tree }`, SHA-256 z `git diff HEAD` oraz listy i hashy nieśledzonych plików, `null`/`null` poza repozytorium, limity czasu na wywołania `git`; zweryfikować przez `process/code-version.test.ts` na repozytorium tymczasowym (`git init`, `git commit`): ten sam odcisk przy dwóch odczytach bez zmian, inny po zmianie śledzonego pliku, inny po dodaniu nieśledzonego pliku, ten sam po dodaniu pliku ignorowanego, `null` w katalogu bez Git.

## 3. Dziennik zadania: zapis i reguły

- [x] 3.1 Napisać w `process/task-log.ts` obsługę zadań: `startTask(dir, description, sessionId, codeVersion)` tworzy katalog zadania, `task.json`, `current-task` i zdarzenie `task_started`; `currentTask(dir)` zwraca zadanie lub `null`; `readEvents(task)` czyta JSONL; `appendEvent(task, event)` dopisuje wiersz; zweryfikować przez `process/task-log.test.ts` (start zadania tworzy pliki, drugi start tworzy drugie zadanie i przełącza `current-task`, zdarzenia pierwszego nietknięte, `readEvents` zwraca je w kolejności zapisu).
- [x] 3.2 Dodać `recordHookEvent(input, dir)` z design D3: przekład `UserPromptSubmit` (`/devguide` → nowe zadanie; inny prompt → `user_prompt`), `PostToolUse` `Write`/`Edit` → `file_changed` z `path`, `created`, `before`, `after`, `patch`; `Bash` → `command_run` z `exit_code: null`, z pominięciem poleceń zawierających `process/cli.ts record`; `PostToolUseFailure` → `tool_failed`; `Stop` → `agent_message`; `SessionStart` przy otwartym zadaniu → `session_resumed` plus zwrócony tekst kontekstu; brak otwartego zadania lub inne zdarzenie → nic; zweryfikować testami z przykładowymi wejściami w kształtach z `docs/claude-code-integration.md` (każdy przypadek powyżej, w tym brak zadania → brak plików i brak kontekstu).
- [x] 3.3 Dodać `appendAgentEvent(task, kind, fields)` z regułami z design D5: `check` → dopasowanie `command_run` po treści lub `--execution`, obecność niepustego `evidence` w `stdout + stderr`, `status` i `reason`; `decision` → `confirmed` i `prompt_event_id` na podstawie `user_prompt`/`task_started`; `hypothesis_resolved` → błąd przy nieistniejącej hipotezie; `materials` zawsze `nature: "illustration"`; zweryfikować testami odpowiadającymi scenariuszom specyfikacji `task-event-log` (cztery dla sprawdzenia, dwa dla decyzji, dwa dla rozstrzygnięcia, materiał jako ilustracja).

## 4. Odczyt i podsumowanie

- [x] 4.1 Napisać `process/replay.ts` z design D7: `summarize(task, events)` (hipotezy ze statusem, sprawdzenia ze `status` i `current`, decyzje niepotwierdzone, liczniki), `formatTimeline(events)` i `formatSummary(summary)` po polsku z prefiksem pochodzenia i identyfikatorem w nawiasie, `formatEvent(event)` z pełnymi polami, `sessionContext(summary)` dla hooka; zweryfikować przez `process/replay.test.ts`: odrzucona hipoteza widoczna z powodem, `current: false` po `file_changed` z innym `code_version`, `current: true` bez późniejszych zmian, `unverified` pokazane osobno z powodem, pusty dziennik daje czytelny komunikat, JSON z `summarize` zgodny z tekstem (te same identyfikatory i statusy).

## 5. Polecenie dla agenta i użytkownika

- [x] 5.1 Napisać `process/cli.ts` z design D6 (`record <kind>` z flagami przez `parseArgs`, `--material` i `--material-file`, `replay [--json] [--event <id>]`, `status`, `--help`), wypis `recorded <kind> <id>`, kod 1 i komunikat po angielsku przy braku zadania lub pola; zweryfikować przez `process/cli.test.ts` jako proces potomny z `DEVGUIDE_DIR` w katalogu tymczasowym: `record` bez zadania → kod 1 z komunikatem; `record hypothesis` bez `--text` → kod 1 ze wskazaniem pola; po `startTask` pełna ścieżka `record observation --material` → `replay --json` zawiera zdarzenie z ilustracją; `replay` bez zadania → kod 0 i komunikat o braku zadania; `node process/cli.ts --help` wypisuje listę podpoleceń.

## 6. Integracja z hookiem

- [x] 6.1 Zmienić `agent/hooks/record-event.ts`: ścieżka surowego dziennika z `process/paths.ts` (`DEVGUIDE_DIR` zamiast `DEVGUIDE_LOG_FILE`), po zapisie surowego wpisu wywołanie `recordHookEvent` w `try/catch` z błędem na stderr, odpowiedź `SessionStart` z `additionalContext` gdy jest kontekst; `code_version` surowego wpisu nadal z commita; zweryfikować przez rozszerzony `agent/hooks/record-event.test.ts`: `/devguide` tworzy zadanie, `PostToolUse` `Edit` daje `file_changed` w zadaniu, `SessionStart` z otwartym zadaniem wypisuje JSON z `additionalContext` zawierającym identyfikator zadania, bez zadania nie wypisuje nic, niezapisywalny katalog zadań → kod 0 i stderr; `npm run check` przechodzi.
- [x] 6.2 Zaktualizować `agent/experiment/settings.json` tylko jeśli potrzebne (zdarzenia bez zmian) i `agent/experiment/run.ts` na `DEVGUIDE_DIR`; zweryfikować, że `npm run check:types` przechodzi i że `node agent/hooks/record-event.ts` z `DEVGUIDE_DIR` ustawionym na katalog tymczasowy i przykładowym `UserPromptSubmit` `/devguide x` na stdin tworzy `tasks/<id>/events.jsonl` w tym katalogu.

## 7. Eksperyment

- [x] 7.1 Rozszerzyć `agent/experiment/run.ts` i `evaluate.ts` zgodnie z design D9: trzy nowe kroki w sesji 1 (obserwacja z materiałem, hipoteza, sprawdzenie dla `echo devguide-ok`), `Bash(node process/cli.ts *)` w `--allowedTools`, pytanie o identyfikator zadania w sesji 2, trzy nowe kryteria (ustalenia agenta w zadaniu ze `status: passed` i `execution_id`, zdarzenia narzędzi w zadaniu bez `command_run` dla CLI, `session_resumed` plus identyfikator zadania w odpowiedzi), narzut czasu i liczba zdarzeń zadania w raporcie; zweryfikować przez rozszerzony `agent/experiment/run.test.ts` (komplet dowodów → osiem „tak”; brak `check` ze `status: passed` → „nie”; brak identyfikatora zadania w odpowiedzi → „nie”; `command_run` dla wywołania CLI → „nie”) i `npm run check`.
- [x] 7.2 Uruchomić `npm run experiment` na Windows z Claude Code 2.1.300; zweryfikować kod wyjścia 0 i osiem „tak”, zachować raport i `.devguide/experiment/tasks/<id>/events.jsonl`; przy wyniku innym niż osiem „tak” nie zmieniać kryteriów, lecz zapisać wynik i przyczynę w tasks.md i w `docs/claude-code-integration.md` (w szczególności dla `additionalContext`).

## 8. Dokumentacja

- [x] 8.1 Napisać `docs/task-event-log.md`: układ katalogów `.devguide/`, koperta zdarzenia, tabela rodzajów z polami i pochodzeniem, reguły statusu sprawdzenia i potwierdzenia decyzji, odcisk drzewa roboczego i zmierzony narzut z 7.2, polecenia CLI z przykładami, co pokazuje `replay`; zweryfikować, że każde polecenie z przykładów uruchamia się dosłownie na zadaniu z eksperymentu (`DEVGUIDE_DIR=.devguide/experiment node process/cli.ts replay`) i `npm run check:links` przechodzi.
- [x] 8.2 Zaktualizować `process/README.md` (co jest w `process/`, jak odczytać zadanie), `agent/README.md` (hook deleguje do `process/`, `DEVGUIDE_DIR`), `README.md` (stan: dziennik zadania istnieje, polecenie `replay`), `CLAUDE.md` (stan projektu i odsyłacz do `docs/task-event-log.md`), `openspec/config.yaml` (stan po Etapie 3), `docs/claude-code-integration.md` (wynik dla `additionalContext`, kształt `PostToolUseFailure` jeśli zaobserwowany, wiersz „Consequences” dla Etapu 3 oznaczony jako zrealizowany); zweryfikować przez `npm run check`.

## 9. Weryfikacja ręczna przyrostu

- [x] 9.1 Na czystym drzewie roboczym wykonać kolejno: `npm run check` (kod 0); usunięcie `.devguide/experiment` i `npm run experiment` (kod 0, osiem „tak”); `DEVGUIDE_DIR=.devguide/experiment node process/cli.ts replay` (przebieg zawiera rozpoczęcie zadania, zmianę `hello.txt` z fragmentem przed/po, polecenie `echo devguide-ok`, obserwację z ilustracją, hipotezę, sprawdzenie ze statusem `passed`, wznowienie sesji; brak wiersza polecenia dla wywołań CLI); `DEVGUIDE_DIR=.devguide/experiment node process/cli.ts record check --what "test" --expected "x" --command "echo nigdy-nie-uruchomione" --evidence "x" --claimed passed` (zapis ze statusem `unverified` i powodem `no_execution`, widoczny w `status` jako niepotwierdzony); `git status --short` (bez plików z `.devguide/`); zapisać w tasks.md wersję Claude Code, system, czas i koszt przebiegu, zmierzony narzut hooka oraz pełny raport eksperymentu.

## Workflow follow-up

- Po przeglądzie przez użytkownika: `/opsx:verify`, potem `/opsx:archive`, które przeniesie specyfikacje `task-event-log` i `task-replay` do `openspec/specs/`.
- Następna zmiana: Etap 4 (lokalny podgląd) na podstawie `summarize` i `replay --json` z tej zmiany.

## Wynik weryfikacji ręcznej (9.1)

Wykonano 2026-10-21 na Windows 11 (win32 x64), Node 24.20.0, Claude Code 2.1.300 (natywny plik wykonywalny, Git Bash), model w sesjach eksperymentu: sonnet.

- `npm run check`: kod 0 (114 testów, linki, `openspec validate --all`).
- `npm run experiment` (runner sam czyści `.devguide/experiment`): kod 0, osiem razy „tak”; sesja 1 17050 ms i 0,116 USD, sesja 2 2534 ms i 0,126 USD; 21 wpisów w surowym dzienniku, 11 zdarzeń w zadaniu `20261021-2144-4698`. Pierwszy przebieg tego samego dnia (zadanie `20261021-2141-1e78`) również 8/8, 17215 ms i 1946 ms, łącznie 0,45 USD.
- Narzut hooka: ok. 120 ms na wywołanie narzędzia (`PreToolUse` → `PostToolUse` minus `duration_ms` narzędzia), ten sam rząd co w Etapie 2; odcisk drzewa roboczego liczony tylko przy zdarzeniach zadania. Dłuższy czas sesji 1 wynika z trzech dodatkowych kroków (tur modelu), nie z hooka.
- `DEVGUIDE_DIR=.devguide/experiment node process/cli.ts replay`: przebieg zawiera rozpoczęcie zadania, utworzenie i zmianę `hello.txt` (w `--json` fragment przed `hello`, po `greetings` i łatka z `structuredPatch`), polecenie `echo devguide-ok` z kodem wyjścia nieznanym, obserwację z jedną ilustracją, hipotezę, sprawdzenie ze statusem `passed`, wznowienie sesji; brak wiersza polecenia dla trzech wywołań `process/cli.ts record`.
- `record check ... --command "echo nigdy-nie-uruchomione" ... --claimed passed`: zapisane (`recorded check 5e15d373`, kod 0), w `status` pokazane jako `[niepotwierdzone]` z powodem „brak zarejestrowanego wykonania polecenia”, obok sprawdzenia `[przeszło]`.
- `additionalContext` w `SessionStart` potwierdzony: w sesji wznowionej agent podał identyfikator zadania, który zna tylko hook.
- `git status --short`: brak plików z `.devguide/`.
- Pełny raport ostatniego przebiegu: `.devguide/experiment/report.txt` (poza Git).
