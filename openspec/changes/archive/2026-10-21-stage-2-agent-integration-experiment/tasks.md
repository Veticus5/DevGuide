# Tasks

## 1. Skrypt hooka i dziennik

- [x] 1.1 Dodać `.devguide/` do `.gitignore`; zweryfikować, że po utworzeniu `.devguide/test.txt` polecenie `git status --short` go nie pokazuje, po czym usunąć plik.
- [x] 1.2 Napisać `agent/hooks/record-event.ts`: odczyt JSON ze stdin, wiersz dziennika z polami `time`, `session_id`, `event`, `source`, `code_version`, `cwd`, `payload`; ścieżka z `DEVGUIDE_LOG_FILE` lub `<cwd>/.devguide/events.jsonl` z utworzeniem katalogu; `code_version` z `git rev-parse HEAD` albo `null`; `Stop` z `source: "agent"`; `UserPromptSubmit` zaczynający się od `/devguide` oznaczony jako start zadania; `PreToolUse` dla `Bash` ze znacznikiem `devguide-block-me` zapisuje odmowę i wypisuje JSON `permissionDecision: "deny"` z powodem; błąd zapisu na stderr i kod 0; zweryfikować ręcznie, że podanie na stdin przykładowego zdarzenia `PostToolUse` (`hook_event_name`, `session_id`, `cwd`, `tool_name`, `tool_input`, `tool_response`) tworzy wiersz w `.devguide/events.jsonl`, a `npm run check:types` przechodzi.
- [x] 1.3 Napisać `agent/hooks/record-event.test.ts` (`node:test`, proces potomny, katalog tymczasowy) z przypadkami z design D7: zapis `PostToolUse`, `Stop` jako `agent`, `SessionStart` z `source: resume`, `PreToolUse` ze znacznikiem → `deny` plus wpis odmowy, `PreToolUse` bez znacznika → brak decyzji na stdout, `UserPromptSubmit` z `/devguide` → start zadania, brak Git → `code_version: null`, niezapisywalny dziennik → kod 0 i stderr; zweryfikować, że `npm run check:test` przechodzi i że celowe zepsucie warunku znacznika powoduje niepowodzenie testu blokady.

## 2. Konfiguracja hooków na czas eksperymentu

- [x] 2.1 Utworzyć `agent/experiment/settings.json` z hookami `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `Stop`, `SessionEnd` (z `timeout` 10) w formie `{"type":"command","command":"node","args":["agent/hooks/record-event.ts"]}`; zweryfikować, że plik parsuje się jako JSON przez wczytanie go w Node.
- [x] 2.2 Sprawdzić ręcznie, że hooki z `--settings` działają w trybie `-p`: uruchomić `claude -p` z promptem „Odpowiedz jednym słowem: ok”, flagami `--settings agent/experiment/settings.json --output-format json` i zmienną `DEVGUIDE_LOG_FILE=.devguide/smoke.jsonl`; zweryfikować, że `.devguide/smoke.jsonl` zawiera `SessionStart`, `UserPromptSubmit` i `Stop` z tym samym `session_id` co pole `session_id` w wyniku; jeśli nie zawiera, zastosować wariant zapasowy z design D4 i odnotować to w `docs/claude-code-integration.md`.

## 3. Skill `/devguide`

- [x] 3.1 Utworzyć `.claude/skills/devguide/SKILL.md` z `name: devguide`, `description`, `disable-model-invocation: true` oraz treścią z design D5 (potwierdzenie trybu, prośba o opis przy pustym `$ARGUMENTS`, wykonanie zadania); zweryfikować ręcznie przez `claude -p` z promptem `/devguide powiedz tylko: gotowe`, flagami jak w 2.2 i osobnym `DEVGUIDE_LOG_FILE`: wynik zawiera potwierdzenie trybu DevGuide, a dziennik zawiera wpis `UserPromptSubmit` oznaczony jako start zadania; jeśli `prompt` nie zawiera `/devguide`, zastosować wariant zapasowy z D5 i odnotować w dokumencie ustaleń.
- [x] 3.2 Sprawdzić, że skill nie uruchamia się sam: `claude -p` z promptem „Napisz jedno zdanie o tym, czym jest devguide w tym repozytorium”, tymi samymi flagami i osobnym `DEVGUIDE_LOG_FILE`; zweryfikować, że dziennik nie zawiera wpisu startu zadania.

## 4. Skrypt eksperymentu

- [x] 4.1 Napisać `agent/experiment/run.ts` zgodnie z design D6 (przygotowanie katalogu `.devguide/experiment/`, sesja 1 z `--session-id`, sesja 2 z `--resume`, odczyt dziennika i dysku, tabela pięciu pytań z wynikiem i dowodem, wypis surowych `tool_response` dla Edit i Bash, kod wyjścia 0 tylko przy pięciu „tak”) oraz dodać skrypt `experiment` do `package.json`; zweryfikować, że `npm run check:types` przechodzi i że `npm run experiment` bez `claude` w PATH kończy się kodem różnym od 0 z czytelnym komunikatem o brakującym Claude Code.
- [x] 4.2 Napisać `agent/experiment/run.test.ts` dla części oceniającej (funkcja oceny dziennika i dysku wydzielona z `run.ts`): dziennik i katalog z kompletem dowodów → pięć „tak”; brak wpisu odmowy przy braku pliku → „nierozstrzygnięte”; istniejący `blocked.txt` → „nie”; brak `SessionStart` z `resume` → „nie”; zweryfikować, że `npm run check:test` przechodzi.
- [x] 4.3 Uruchomić `npm run experiment` na Windows z Claude Code 2.1.300; zweryfikować kod wyjścia 0 i zachować wypisany raport oraz plik `.devguide/experiment/events.jsonl` do następnego zadania; przy wyniku innym niż pięć „tak” nie poprawiać kryteriów, lecz zapisać wynik i przyczynę.

## 5. Dokument ustaleń i dokumentacja

- [x] 5.1 Napisać `docs/claude-code-integration.md` na podstawie raportu z 4.3: tabela pięciu pytań (odpowiedź, dowód z poleceniem, datą, wersją Claude Code i systemem, ograniczenia, konsekwencje dla Etapów 3–6), zaobserwowane kształty `tool_response` dla Write, Edit i Bash, koszt przebiegu z `total_cost_usd`, sekcja „czego nie potwierdzono” (m.in. PowerShell bez Git Bash, tryb interaktywny, Linux); zweryfikować, że każde „tak” w tabeli ma wskazany konkretny wpis dziennika lub plik.
- [x] 5.2 Zaktualizować `agent/README.md` (co jest w `hooks/` i `experiment/`, gdzie leży skill, jak uruchomić eksperyment), `README.md` (sekcja o `npm run experiment` i jego wymaganiach), `CLAUDE.md` (stan projektu: integracja potwierdzona eksperymentem, odsyłacz do dokumentu ustaleń) i `openspec/config.yaml` (kontekst integracji zastąpiony odsyłaczem do `docs/claude-code-integration.md` i jednym zdaniem o zasadzie potwierdzania eksperymentem); zweryfikować przez `npm run check:links`.

## 6. Weryfikacja ręczna przyrostu

- [x] 6.1 Na czystym drzewie roboczym (`git status --short` puste poza plikami zmiany) wykonać kolejno: `npm run check` (kod 0), usunięcie katalogu `.devguide/experiment` i `npm run experiment` (kod 0, raport z pięcioma „tak”), sprawdzenie `.devguide/experiment/work` (jest `hello.txt`, nie ma `blocked.txt`), zliczenie wpisów `SessionStart` w `.devguide/experiment/events.jsonl` (co najmniej 2, w tym jeden z `source: resume`), `git status --short` (bez plików z `.devguide/`); zapisać w podsumowaniu zmiany wersję Claude Code, system, czas i koszt przebiegu oraz pełny raport eksperymentu.

## Wynik weryfikacji ręcznej (6.1)

Wykonano 2026-10-21 na Windows 11 (win32 x64), Node 24.20.0, Claude Code 2.1.300 (natywny plik wykonywalny, Git Bash), model w sesjach eksperymentu: sonnet.

- `npm run check`: kod 0 (33 testy, linki, `openspec validate --all`).
- `npm run experiment` po usunięciu `.devguide/experiment`: kod 0, pięć razy „tak”; sesja 1 9275 ms i 0,091 USD, sesja 2 1428 ms i 0,099 USD, 15 wpisów w dzienniku.
- `.devguide/experiment/work`: jest `hello.txt` o treści `greetings from devguide`, nie ma `blocked.txt`.
- Wpisy `SessionStart`: 2, w tym 1 z `source: resume` i tym samym `session_id`.
- `git status --short`: brak plików z `.devguide/`.
- Pierwszy przebieg eksperymentu (przed poprawką treści skilla) dał „nie” dla pytania o skill, bo pole `result` trybu `-p` zawiera tylko ostatnią wiadomość; transkrypt pokazał zdanie potwierdzające jako pierwszą wiadomość. Opis w `docs/claude-code-integration.md`.
- Pełny raport ostatniego przebiegu: `.devguide/experiment/report.txt` (poza Git).

## Workflow follow-up

- Po przeglądzie przez użytkownika: `/opsx:verify`, potem `/opsx:archive`, które przeniesie specyfikacje `agent-activity-log`, `operation-block` i `task-entry-point` do `openspec/specs/`.
- Następna zmiana: Etap 3 (zapis przebiegu zadania) oparty na faktycznych kształtach zdarzeń z `docs/claude-code-integration.md`.
