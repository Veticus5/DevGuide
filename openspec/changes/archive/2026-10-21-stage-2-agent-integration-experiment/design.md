# Design

## Context

Motywacja: `proposal.md` — Why. Wymagania: `specs/agent-activity-log`, `specs/operation-block`, `specs/task-entry-point`.

Stan repozytorium: szkielet z Etapu 1, katalog `agent/` zawiera tylko README. Brak jakiegokolwiek kodu integracji. Środowisko, na którym powstanie potwierdzenie: Windows 11, Claude Code 2.1.300 (uruchamiany z Git Bash), Node 24. CI działa na Linuksie i nie ma dostępu do Claude Code.

Fakty z aktualnej dokumentacji Claude Code (code.claude.com/docs, odczyt 2026-10-21), na których opiera się projekt:

- Hooki typu `command` konfiguruje się w `settings.json` (użytkownika, projektu, `--settings <plik>` przy starcie, wtyczki). Dostają JSON na stdin ze wspólnymi polami (`session_id`, `transcript_path`, `cwd`, `hook_event_name`, `permission_mode`) i polami zdarzenia. Domyślny limit czasu hooka `command` to 600 s; hooki pasujące do zdarzenia działają równolegle; pracują w katalogu bieżącym sesji; dostępna jest zmienna `CLAUDE_PROJECT_DIR`.
- `PreToolUse` (`tool_name`, `tool_input`, `tool_use_id`) blokuje wywołanie przez JSON na stdout `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"..."}}` albo przez kod wyjścia 2 z powodem na stderr. `deny` ma pierwszeństwo przed `ask` i `allow`.
- `PostToolUse` dostaje `tool_input` i `tool_response`; kształt `tool_response` zależy od narzędzia (dla Bash udokumentowano `stdout`, `stderr`, `interrupted`; dla Write `filePath`, `type`; dla Edit kształt nieudokumentowany; kod wyjścia Bash nieudokumentowany). `PostToolUseFailure` dostaje `error`.
- `UserPromptSubmit` dostaje `prompt`. `Stop` dostaje `last_assistant_message` i `stop_hook_active`. `SessionStart` dostaje `source` (`startup`, `resume`, `clear`, `compact`, `fork`). `SessionEnd` dostaje `reason` i ma domyślny limit 1,5 s.
- Na Windows zalecana jest forma wykonywalna `{"command":"node","args":[...]}` zamiast polecenia powłoki; bez Git Bash hooki idą przez PowerShell, gdzie `$CLAUDE_PROJECT_DIR` nie rozwija się.
- Skille: `.claude/skills/<name>/SKILL.md`, wywołanie `/<name>`, `$ARGUMENTS`, `disable-model-invocation: true` wyłącza samodzielne użycie przez model.
- Tryb nieinteraktywny: `claude -p "<prompt>" --output-format json` zwraca m.in. `session_id` i `result`; hooki z ustawień działają w `-p` (wyłącza je dopiero `--bare`); sesje z `-p` da się wznowić przez `claude -p --resume <id>`; dostępne `--session-id <uuid>`, `--allowedTools`, `--permission-mode`, `--permission-prompts none`, `--max-turns`, `--max-budget-usd`.

Niepotwierdzone w dokumentacji, do rozstrzygnięcia eksperymentem: czy hooki podane przez `--settings` są scalane z pozostałymi; czy `deny` z `PreToolUse` jest respektowane w `-p`; czy `UserPromptSubmit` widzi surowy tekst `/devguide ...` czy już rozwinięty skill; dokładny kształt `tool_response` dla Edit i obecność kodu wyjścia dla Bash; czy `${CLAUDE_PROJECT_DIR}` rozwija się wewnątrz `args`.

## Goals / Non-Goals

**Goals:**

- Każde z pięciu pytań Etapu 2 dostaje odpowiedź popartą zapisem w dzienniku lub stanem dysku, uzyskanym jednym powtarzalnym poleceniem.
- Kod integracji jest tak mały, że da się go w całości przeczytać: jeden skrypt hooka, jeden skill, jeden skrypt eksperymentu.
- Codzienna praca nad DevGuide w Claude Code nie zmienia się: hooki nie są aktywne poza eksperymentem.
- Części, które będą rozwijane w Etapach 3, 5 i 6 (dziennik, skill, blokada), mają od razu właściwą lokalizację, żeby nie przenosić plików później.

**Non-Goals:**

- Projektowanie docelowego formatu zdarzeń, podglądu ani punktu kontroli. Dziennik z tej zmiany to surowe zdarzenia narzędzi.
- Obsługa sytuacji, w których hook jest niedostępny (np. Claude Code bez Git Bash i bez Node w PATH) — odnotowana jako ograniczenie, nie rozwiązana.
- Automatyczne uruchamianie eksperymentu w CI.

## Decisions

### D1. Jeden skrypt hooka dla wszystkich zdarzeń

`agent/hooks/record-event.ts` czyta JSON ze stdin, rozpoznaje `hook_event_name` i dopisuje jeden wiersz JSON do dziennika. Dla `PreToolUse` dodatkowo decyduje o blokadzie. Jeden skrypt zamiast pięciu oznacza jedną ścieżkę w konfiguracji, jeden zestaw testów i jedno miejsce, w którym Etap 3 zmieni format zapisu.

Alternatywa: osobny skrypt na zdarzenie — czytelniejsza konfiguracja, ale pięciokrotnie więcej plików przy identycznej logice zapisu.

### D2. Dziennik to plik JSONL w `.devguide/` w katalogu roboczym

Domyślna ścieżka: `<cwd ze stdin>/.devguide/events.jsonl`; zmienna środowiskowa `DEVGUIDE_LOG_FILE` nadpisuje ją (eksperyment i testy używają własnych plików). Katalog `.devguide/` trafia do `.gitignore`. Każdy wiersz ma stałe pola: `time` (ISO 8601), `session_id`, `event` (nazwa zdarzenia hooka), `source` (`hook`), `code_version` (`git rev-parse HEAD` lub `null`), `cwd`, oraz `payload` z resztą danych wejściowych hooka bez zmian. Ostatnia wypowiedź agenta ze `Stop` dostaje `source: "agent"`, żeby obserwacje narzędzi były odróżnialne od tekstu agenta już na poziomie zapisu.

Wersja kodu jest pobierana przez `execFileSync("git", ["rev-parse", "HEAD"])` z `cwd` ze stdin, z przechwyceniem błędu. Koszt to kilkadziesiąt milisekund na zdarzenie, akceptowalny na etapie eksperymentu; Etap 3 zdecyduje, czy buforować.

Alternatywa: SQLite przez `node:sqlite` — zbędne, dopóki dziennik czyta tylko skrypt eksperymentu; JSONL da się przeglądać zwykłym `cat`.

### D3. Zapis nigdy nie blokuje agenta, blokada ma jasno określony zakres

Każde zdarzenie poza blokadą kończy się kodem 0 niezależnie od powodzenia zapisu; błąd zapisu idzie na stderr. Dla `PreToolUse` skrypt zwraca `deny` wyłącznie, gdy `tool_name` to `Bash` i `tool_input.command` zawiera znacznik `devguide-block-me`. Odpowiedź to JSON `hookSpecificOutput` z `permissionDecision: "deny"` i czytelnym `permissionDecisionReason`; kod wyjścia 0. Wybrano JSON zamiast kodu 2, bo jest udokumentowany jako bieżący format i pozwala przekazać powód bez mieszania go z diagnostyką na stderr. Wpis o odmowie trafia do dziennika, zanim skrypt odpowie.

Znacznik jest celowo sztuczny: w tej zmianie dowodzimy mechanizmu, nie polityki. Etap 6 zastąpi warunek właściwą regułą (np. zapis poza zatwierdzoną poprawką).

### D4. Hooki ładowane tylko na czas eksperymentu przez `--settings`

Konfiguracja hooków leży w `agent/experiment/settings.json` i jest podawana do `claude` flagą `--settings`. Dzięki temu sesje deweloperskie w tym repozytorium (w tym praca nad OpenSpec) nie uruchamiają hooków przy każdym narzędziu i nie zaśmiecają dziennika. Konfiguracja używa formy wykonywalnej `{"type":"command","command":"node","args":["agent/hooks/record-event.ts"]}` ze ścieżką względną wobec katalogu bieżącego sesji, bo to katalog repozytorium; unika to pytania o rozwijanie `${CLAUDE_PROJECT_DIR}` w `args` na Windows. Zdarzenia: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `Stop`, `SessionEnd`, każde bez matchera (wszystkie narzędzia). Dla `SessionEnd` ustawiamy `timeout` na 10 s ze względu na domyślne 1,5 s.

Jeśli eksperyment pokaże, że `--settings` nie dodaje hooków, zapasowym wariantem jest wpis w `.claude/settings.json` z tym samym skryptem; wtedy skrypt dostaje dodatkowy warunek: zapisuje tylko, gdy ustawiono `DEVGUIDE_LOG_FILE`. Wybór wariantu zostaje odnotowany w dokumencie ustaleń.

Alternatywa: wtyczka ładowana przez `--plugin-dir agent/` (hooki + skill w jednym katalogu) — atrakcyjna dla późniejszej instalacji w obcym repozytorium, ale wprowadza nieprzetestowany format wtyczki do zmiany, której celem jest weryfikacja podstaw. Do rozważenia po Etapie 2.

### D5. Skill `/devguide` istnieje od razu pod docelową nazwą

`.claude/skills/devguide/SKILL.md` z `disable-model-invocation: true`. Treść: potwierdź jednym zdaniem, że działasz w trybie DevGuide; jeśli `$ARGUMENTS` jest pusty, poproś o opis zadania; w przeciwnym razie wykonaj opisane zadanie. Nazwa jest ta z planu, żeby Etap 5 tylko rozbudował treść. Skill musi leżeć w `.claude/skills/`, bo tylko tam Claude Code go znajdzie; `agent/README.md` wskazuje to miejsce.

Ślad rozpoczęcia zadania zapisuje hook `UserPromptSubmit`, gdy `prompt` zaczyna się od `/devguide` — to obserwacja wejścia użytkownika, nie polecenie wykonane przez agenta. Jeżeli eksperyment pokaże, że `prompt` zawiera już rozwinięty skill, wariantem zapasowym jest rozpoznanie stałego nagłówka skilla w treści; wynik trafia do dokumentu ustaleń.

### D6. Eksperyment to skrypt Node, który uruchamia `claude -p` dwa razy i sprawdza skutki

`agent/experiment/run.ts`, uruchamiany przez `npm run experiment`:

1. Sprawdza obecność `claude` (`claude --version`) i zapisuje wersję do raportu. Tworzy pusty plik dziennika `.devguide/experiment/events.jsonl` i pusty katalog roboczy `.devguide/experiment/work/`; ustawia `DEVGUIDE_LOG_FILE`.
2. Generuje UUID sesji i słowo-klucz. Uruchamia sesję 1: `claude -p --session-id <uuid> --settings agent/experiment/settings.json --output-format json --permission-mode acceptEdits --allowedTools "Write,Edit,Read,Bash(echo *)" --permission-prompts none --max-turns 15 --max-budget-usd 1` z promptem `/devguide <zadanie>`. Zadanie prosi agenta kolejno o: utworzenie pliku `work/hello.txt` o podanej treści, zmianę jednego słowa w tym pliku, uruchomienie `echo devguide-ok`, uruchomienie `echo devguide-block-me > work/blocked.txt` i opisanie, co się stało, oraz zapamiętanie słowa-klucza.
3. Uruchamia sesję 2: `claude -p --resume <uuid> --settings ... --output-format json --max-turns 3` z promptem „Jakie słowo-klucz podałem? Odpowiedz samym słowem.”.
4. Czyta dziennik i dysk, a następnie wypisuje tabelę: pytanie z planu, wynik (`tak` / `nie` / `nierozstrzygnięte`), dowód (wpis dziennika lub plik). Kryteria:
   - skill: odpowiedź sesji 1 zawiera potwierdzenie trybu DevGuide i dziennik ma wpis `UserPromptSubmit` rozpoznany jako start zadania z treścią zadania;
   - odbiór działań: dziennik ma `SessionStart` (`source: startup`), co najmniej po jednym `PreToolUse` i `PostToolUse` dla `Write`, `Edit`, `Bash`, oraz `Stop` z tekstem agenta;
   - zmiany plików i polecenia: wpis `PostToolUse` dla `Write` wskazuje `work/hello.txt`; wpis dla `Bash` zawiera `devguide-ok` w wyniku; raport wypisuje surowy kształt `tool_response` dla Edit i Bash, żeby zasilić dokument ustaleń;
   - zatrzymanie: `work/blocked.txt` nie istnieje, dziennik ma wpis odmowy z treścią polecenia, a jeśli odpowiedź agenta twierdzi inaczej, raport odnotowuje rozbieżność;
   - wznowienie: dziennik ma `SessionStart` z `source: resume` i tym samym `session_id`, a odpowiedź sesji 2 zawiera słowo-klucz.
5. Kończy się kodem 0 tylko gdy każde pytanie ma `tak`. Dziennik i raport zostają w `.devguide/experiment/` do wglądu.

Wywołanie `claude` idzie przez `spawnSync` bez powłoki: instalacja natywna Claude Code to plik wykonywalny (`claude.exe` na Windows), więc powłoka nie jest potrzebna, a brak powłoki eliminuje problemy z cudzysłowami w argumentach. Prompt przekazywany jest przez stdin. Jeśli `claude` jest skryptem `.cmd` z instalacji przez npm, skrypt zgłosi brak Claude Code; obsługa tego wariantu nie jest celem tej zmiany.

Pole `result` w wyjściu `-p` zawiera tylko ostatnią wiadomość agenta, nie pierwszą. Dlatego skill prosi o zdanie potwierdzające zarówno na początku pierwszej odpowiedzi, jak i na początku końcowego raportu; kryterium sprawdza `result`. Pierwszy przebieg eksperymentu (bez tego zdania w raporcie końcowym) dał „nie” dla pytania o skill mimo poprawnego pierwszego komunikatu widocznego w transkrypcie; opis w dokumencie ustaleń.

Alternatywa: ręczna lista kroków w dokumencie — tańsza w napisaniu, ale niepowtarzalna i podatna na „wydawało mi się, że działa”. Skrypt ma być tym, co uruchamiamy po każdej aktualizacji Claude Code.

### D7. Testy jednostkowe hooka bez Claude Code

`agent/hooks/record-event.test.ts` uruchamia skrypt jako proces potomny (`node agent/hooks/record-event.ts`) z przykładowym JSON na stdin, `DEVGUIDE_LOG_FILE` w katalogu tymczasowym i `cwd` wskazującym katalog tymczasowy. Przypadki: zapis `PostToolUse` z pełnym `payload`; `Stop` z `source: "agent"`; `SessionStart` z `source: resume` zachowanym w `payload`; `PreToolUse` z poleceniem zawierającym znacznik zwraca `deny` i zapisuje odmowę; `PreToolUse` bez znacznika nie wypisuje decyzji; `UserPromptSubmit` z `/devguide x` oznaczony jako start zadania; brak repozytorium Git daje `code_version: null`; niezapisywalny plik dziennika kończy się kodem 0 i komunikatem na stderr. Testy obejmuje istniejące `npm run check:test` (wzorzec `agent/**/*.test.ts`), więc działają w CI na Linuksie.

### D8. Dokument ustaleń jest produktem zmiany na równi z kodem

`docs/claude-code-integration.md`: tabela pięciu pytań z odpowiedzią, dowodem (polecenie, data, wersja Claude Code, system), ograniczeniami i konsekwencją dla kolejnych etapów; sekcja o zaobserwowanych kształtach `tool_response`; sekcja „czego nie potwierdzono”. Dokument powstaje z wyników `npm run experiment`, nie z dokumentacji. Kontekst w `openspec/config.yaml` zostaje skrócony do odsyłacza do tego dokumentu.

## Risks / Trade-offs

- [Hooki z `--settings` nie są scalane] → wariant zapasowy z D4 (`.claude/settings.json` + warunek na `DEVGUIDE_LOG_FILE`); decyzja zapisana w dokumencie ustaleń.
- [`deny` w `PreToolUse` nie działa w trybie `-p` lub działa inaczej niż interaktywnie] → eksperyment zgłasza `nie`; dokument ustaleń opisuje ograniczenie i wariant (np. `PermissionRequest` lub tryb interaktywny), zgodnie z Etapem 6 planu. Nie zastępujemy blokady instrukcją w prompcie.
- [Agent w sesji 1 nie wykonuje kroków w oczekiwany sposób (pomija krok, używa innego narzędzia)] → zadanie jest sformułowane jako lista z konkretnymi narzędziami; `--max-turns` i `--max-budget-usd` ograniczają koszt; raport rozróżnia „mechanizm nie działa” od „agent nie wykonał kroku” po tym, czy w dzienniku jest `PreToolUse` dla danego narzędzia.
- [Kształt `tool_response` różni się od założeń] → skrypt zapisuje `tool_response` bez przetwarzania; kryteria sprawdzają tylko obecność ścieżki i tekstu w serializowanym wpisie; dokument ustaleń opisuje faktyczny kształt.
- [`UserPromptSubmit` nie widzi `/devguide`] → wariant zapasowy z D5.
- [Hooki spowalniają sesję (uruchomienie Node i `git rev-parse` przy każdym zdarzeniu)] → akceptowalne w eksperymencie; raport wypisuje czas trwania sesji; Etap 3 zdecyduje o buforowaniu.
- [Eksperyment wymaga zalogowanego Claude Code i zużywa tokeny] → nie wchodzi do `npm run check`; dokument ustaleń podaje koszt z pola `total_cost_usd`.
- [Na maszynie bez Git Bash hooki idą przez PowerShell] → forma wykonywalna `node` + `args` jest niezależna od powłoki; ograniczenie odnotowane, nietestowane w tej zmianie.
- [Sesja 1 nie kończy się `SessionEnd` w `-p` w oczekiwany sposób] → kryterium wznowienia opiera się na `SessionStart` z `source: resume`, nie na `SessionEnd`.

## Open Questions

- Czy po Etapie 2 integracja ma przyjąć postać wtyczki Claude Code (`--plugin-dir`), żeby dało się ją zainstalować w obcym repozytorium na Etap 8? Nie wpływa na tę zmianę; rozstrzygnięcie przy planowaniu Etapu 5.
