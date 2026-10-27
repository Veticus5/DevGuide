# Design

## Context

Motywacja i przyczyna: `proposal.md` — Why. Wymagania: `specs/guiding-skill`, delta `specs/task-entry-point`.

Stan: `.claude/skills/devguide/SKILL.md` to skill z Etapu 2 (`disable-model-invocation: true`, `$ARGUMENTS` jako opis zadania, stała linia potwierdzenia „DevGuide mode is active.”, zdanie „you do not need to describe your actions”). Eksperyment (`agent/experiment/run.ts`) wywołuje go w sesji 1 z listą kroków, w których polecenia CLI są podane dosłownie, więc nie sprawdza, czy agent zapisuje ustalenia sam. Hook przy `SessionStart` przekazuje `sessionContext` (`process/replay.ts`): identyfikator zadania, liczniki i polecenie `replay`. CLI `node process/cli.ts record` obsługuje `observation`, `hypothesis`, `hypothesis_resolved`, `proposal`, `change_prepared`, `change_explained`, `decision`, `check`; reguły statusów egzekwuje zapis. Dowód, że zapis działa, gdy agent dostaje polecenia: 9/9 w eksperymencie.

Fakty o Claude Code istotne tutaj (`docs/claude-code-integration.md`): skill jest wstrzykiwany jako treść promptu; hook widzi tylko narzędzia, nie rozumowanie; `last_assistant_message` trafia do dziennika jako `agent_message`.

## Goals / Non-Goals

**Goals:**

- Agent zapisuje ustalenia sam, w trakcie pracy, w momentach, które skill nazywa wprost, i kopiuje polecenia weryfikujące dosłownie.
- Skill jest krótki (jedna strona), a każda instrukcja ma gotowe polecenie CLI do skopiowania, bo błędy cudzysłowów są główną przyczyną nieudanych zapisów.
- Sprawdzenie potwierdzone eksperymentem na naturalnym zadaniu, nie na liście poleceń.

**Non-Goals:**

- Egzekwowanie zgody na zastosowanie poprawki (Etap 6).
- Procedury dla konkretnych stosów i projektów; integracja z OpenSpec w repozytorium użytkownika.
- Gwarancja, że model zawsze zapisze każde ustalenie; eksperyment mierzy minimum (obserwacja, objaśnienie, sprawdzenie), a podgląd pokazuje uczciwie, czego brakuje.

## Decisions

### D1. Jeden plik skillu, pięć krótkich sekcji, polecenia do skopiowania

`SKILL.md` zachowuje nagłówek (`name`, `description`, `argument-hint`, `disable-model-invocation: true`) i linię potwierdzenia na początku i na końcu pracy (eksperyment na niej polega). Treść:

1. **Rozpoznanie problemu**: odtwórz problem lub obejrzyj stan wyjściowy; zapisz obserwację z przykładem (`record observation --text … --files … --material "przykład=…"`); gdy zgadujesz przyczynę, zapisz podejrzenie (`record hypothesis --text …`) i po sprawdzeniu rozstrzygnij je (`record hypothesis_resolved --hypothesis <id> --outcome confirmed|rejected --text …`).
2. **Planowanie**: przy zmianie większej niż jeden plik zapisz propozycję (`record proposal --text …`); gdy potrzebna jest decyzja użytkownika, zadaj pytanie, a po odpowiedzi zapisz decyzję (`record decision --question … --quote "<dokładne słowa>" --reading …`) przed działaniem.
3. **Implementacja**: pliki zmieniaj tylko narzędziami Write i Edit; po każdej logicznej poprawce zapisz objaśnienie (`record change_explained --title … --purpose … --mechanism … --assumptions … --files a,b --material "przykład=…"`); ścieżki w `--files` podawaj względem katalogu repozytorium, z `/`.
4. **Weryfikacja**: uruchom polecenie, które sprawdza zachowanie, a potem zapisz sprawdzenie z dokładnie tym poleceniem i cytatem z wyjścia (`record check --what … --expected … --command "<dosłownie to samo>" --evidence "<fragment wyjścia>" --claimed passed|failed|inconclusive --limits …`). Nie zapisuj sprawdzenia dla polecenia, które tylko wypisuje tekst. Nie deklaruj `passed` bez cytatu.
5. **Wyjaśnianie**: w raporcie końcowym wymień, co zapisano, co jest potwierdzone wykonaniem, a co pozostaje przypuszczeniem; zgłoś odmowy i błędy.

Zakazy w jednym bloku: nie wymyślaj wyników, nie zapisuj objaśnień zmian, których nie wykonałeś, nie używaj `sed`/`printf`/przekierowań do zmian w plikach, nie pomijaj odmów.

Alternatywy: kilka skillów (po jednym na fazę) — plan prosi o jeden; oddzielne pliki instrukcji ładowane przez skill — więcej plików bez korzyści przy jednej stronie treści; wymuszanie zapisów hookiem (np. blokada Write bez wcześniejszego `change_explained`) — to kontrola, a nie prowadzenie; rozważy ją Etap 6.

### D2. Kontekst sesji przypomina zasady i rozróżnia wznowienie od nowej sesji

`sessionContext` (po angielsku, odbiorcą jest agent) dostaje po liczbach trzy zdania: „Record findings as you work: `node process/cli.ts record observation|hypothesis|change_explained|check …` (see `/devguide` skill). Change files only with Write and Edit. A check needs the exact command you ran and a quote from its output.” Dzięki temu wznowiona sesja (`--resume`, także `compact`) zachowuje się jak pierwsza, mimo że skill nie jest ponownie wstrzykiwany.

Ustalenie z pierwszego przebiegu eksperymentu (2026-10-27): nowa sesja (`source: startup`) przy otwartym zadaniu z poprzedniej sesji dostawała pełny opis tego zadania i wykonała je ponownie, zanim zajęła się własnym. Dlatego dla `startup` kontekst mówi tylko, że wcześniejsze zadanie jest otwarte (opis przycięty do 160 znaków), i każe go nie kontynuować bez prośby użytkownika; nowe `/devguide` otwiera nowe zadanie. `recordHookEvent` przekazuje `source` do `sessionContext`.

### D3. Eksperyment: trzecia sesja z naturalnym zadaniem

`run.ts` po sesji 2 uruchamia sesję 3 (nowy `--session-id`, ten sam `DEVGUIDE_DIR`): `/devguide W katalogu .devguide/experiment/work utwórz plik note.txt z tekstem "hello there", zamień hello na greetings i sprawdź, że plik zawiera greetings.` Bez wymieniania `process/cli.ts`. `--allowedTools` jak w sesji 1 plus `Bash(cat *)`, `Bash(type *)`, `Bash(node process/cli.ts *)`; `--max-turns 25`, `--max-budget-usd 2`. Nowe zadanie (sesja 3 otwiera własne przez `/devguide`), więc `evaluate` dostaje `thirdTaskEvents`. Pytanie 10 „Czy agent sam zapisuje ustalenia w trakcie naturalnego zadania”: zadanie sesji 3 ma `observation`, `file_changed` z narzędzia `Edit` dla `note.txt` z `before` zawierającym `hello` i `after` zawierającym `greetings`, `change_explained` z `change_ids` zawierającym to zdarzenie, `check` ze statusem `passed`, którego `execution_id` wskazuje `command_run` z `greetings` w `stdout`; brak `command_run` z `sed`. Raport wypisuje listę rodzajów zdarzeń sesji 3. Kod wyjścia 0 tylko przy dziesięciu „tak”.

Dlaczego osobna sesja, a nie zmiana sesji 1: sesja 1 testuje mechanikę hooków i CLI na dosłownych krokach i jest stabilna; naturalne zadanie jest z natury mniej deterministyczne, więc jego ewentualne „nie” nie powinno zasłaniać wyników 1–9. Podgląd z pytania 9 nadal czyta zadanie sesji 1 (`--task` nie jest potrzebne: `fetchPreview` używa `readTask` z identyfikatorem zadania sesji 1 zamiast `currentTask`).

### D4. Testy bez Claude Code

- `agent/experiment/run.test.ts`: komplet dowodów sesji 3 → dziesięć „tak”; brak `change_explained` → „nie”; zmiana przez `sed` zamiast `Edit` → „nie”; `check` bez `passed` → „nie”.
- `process/replay.test.ts`: `sessionContext` zawiera trzy zdania zasad.
- Treść `SKILL.md` sprawdza test w `agent/hooks`? Nie: skill to prompt, jego skuteczność mierzy eksperyment; test jednostkowy sprawdza tylko, że plik ma nagłówek z `disable-model-invocation: true` i linię potwierdzenia (`agent/experiment/run.test.ts`, bo tam jest `CONFIRMATION_LINE`).

### D5. Zapis odpowiada statusem, żeby agent widział od razu, że deklaracja nie została potwierdzona

Ustalenie z drugiego przebiegu (2026-10-27): agent zadeklarował w raporcie uruchomienie `grep` i jego wynik, choć nigdy go nie uruchomił; dziennik zapisał sprawdzenie jako `unverified` (`no_execution`). Żeby skill mógł na to zareagować w trakcie pracy, `node process/cli.ts record` wypisuje po identyfikatorze decyzję dziennika: dla `check` `status=passed execution=<id>` albo `status=unverified reason=<powód>: <co zrobić>`; dla `decision` `confirmed=true|false`; dla `change_explained` `changes=<identyfikatory>` albo `changes=none`. Skill każe przeczytać tę linię, a przy `unverified` uruchomić polecenie i zapisać sprawdzenie ponownie, oraz zabrania raportować „passed”, gdy dziennik mówi `unverified`. Alternatywa (hook blokujący `record check` bez wcześniejszego wykonania) to kontrola, nie prowadzenie; reguła dziennika i tak zapisuje prawdę, a podgląd ją pokazuje.

## Risks / Trade-offs

- [Model w sesji 3 nie zapisze któregoś ustalenia] → pytanie 10 „nie”, raport pokazuje, co zapisał; kryteriów nie zmieniamy, wynik i przyczyna trafiają do `docs/claude-code-integration.md`; skill można zaostrzyć o przykład, nie o przymus.
- [Agent kopiuje polecenie sprawdzenia w innym brzmieniu niż je uruchomił] → status `unverified` z `no_execution`; skill mówi „dokładnie to samo polecenie”, a `--execution <id>` jest opisane jako wyjście awaryjne; eksperyment to wychwyci.
- [Dłuższy skill zwiększa koszt każdego zadania] → jedna strona, ok. 600 tokenów na sesję; mierzone kosztem sesji 3 w raporcie.
- [Agent zapisuje sprawdzenia dla `echo`] → zakaz wprost w skillu; podgląd i tak pokaże „przeszło”, bo dowód jest w wyjściu; ocena trafności dowodu pozostaje przy użytkowniku (jak w Etapie 3).

## Open Questions

- Czy skill ma prosić o decyzję przed zastosowaniem każdej poprawki, czy tylko przy zmianach wielu plików? W tej zmianie: tylko gdy agent sam widzi wybór wariantów; Etap 6 ustali punkt kontroli i wtedy skill dostanie jednoznaczną regułę.
