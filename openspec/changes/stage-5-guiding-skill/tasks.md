# Tasks

## 1. Skill prowadzący

- [x] 1.1 Przepisać `.claude/skills/devguide/SKILL.md` zgodnie z design D1: nagłówek bez zmian, linia potwierdzenia na początku i na końcu, pięć sekcji z poleceniami CLI do skopiowania, blok zakazów; zweryfikować przez `agent/experiment/run.test.ts` (plik ma `disable-model-invocation: true`, linię potwierdzenia i każde z poleceń `record observation`, `record change_explained`, `record check`) i ręcznie przez `node process/cli.ts --help`, że każde polecenie w skillu ma te same flagi co CLI.
- [x] 1.2 Rozszerzyć `sessionContext` w `process/replay.ts` o trzy zdania zasad z design D2; zweryfikować przez `process/replay.test.ts` (kontekst zawiera `record observation`, `Write and Edit`, `exact command`).

## 2. Eksperyment

- [x] 2.1 Dodać w `agent/experiment/run.ts` sesję 3 z naturalnym zadaniem i w `evaluate.ts` pytanie 10 zgodnie z design D3 (`thirdTaskEvents`, kryteria: obserwacja, `file_changed` z `Edit` dla `note.txt` z `hello` → `greetings`, `change_explained` wskazujące tę zmianę, `check` `passed` z wykonaniem zawierającym `greetings`, brak `sed`), `fetchPreview` czytające zadanie sesji 1 po identyfikatorze, lista rodzajów zdarzeń sesji 3 w raporcie, kod 0 tylko przy dziesięciu „tak”; zweryfikować przez `agent/experiment/run.test.ts` (komplet → dziesięć „tak”; brak objaśnienia → „nie”; `sed` zamiast `Edit` → „nie”; sprawdzenie bez `passed` → „nie”) i `npm run check`.
- [x] 2.2 Uruchomić `npm run experiment`; zweryfikować kod wyjścia 0 i dziesięć „tak”; przy wyniku „nie” dla pytania 10 nie zmieniać kryteriów, lecz zapisać, co agent zapisał, a czego nie, w tasks.md i w `docs/claude-code-integration.md`, i poprawić skill co najwyżej o przykład.

## 3. Dokumentacja

- [x] 3.1 Zaktualizować `docs/claude-code-integration.md` (pytanie 10, koszt sesji 3, wiersz „Consequences” dla Etapu 5 jako zrealizowany), `docs/task-event-log.md` (skill jako źródło ustaleń), `README.md` (stan: skill prowadzi zadanie), `CLAUDE.md` (stan projektu), `openspec/config.yaml` (stan po Etapie 5); zweryfikować przez `npm run check`.

## 4. Weryfikacja ręczna przyrostu

- [ ] 4.1 Uruchomić `npm run preview` w repozytorium i w drugim terminalu `claude --settings agent/experiment/settings.json`, wpisać `/devguide Utwórz plik .devguide/scratch/greet.txt z tekstem hello, zamień hello na greetings i sprawdź, że plik zawiera greetings`; zweryfikować w przeglądarce, że w trakcie pracy historia dostaje kolejno obserwację, zmianę z objaśnieniem (fragment przed/po z narzędzia Edit) i sprawdzenie ze statusem „przeszło” z dowodem, że zakładka „Wyniki sprawdzeń” pojawia się dopiero po pierwszym sprawdzeniu, a po zakończeniu sesji linia stanu mówi „Sesja zakończona”; porównać ze starą sesją `20261021-2226-2fbb` (kroki odtworzone z poleceń); zapisać w tasks.md, co agent zapisał, czego nie, i koszt sesji.

## Workflow follow-up

- Zmiana zależy od grupy 10 zmiany `stage-4-local-preview` (zakładki warunkowe, stan wykonania); archiwizować po niej.
- Po przeglądzie: `/opsx:verify`, `/opsx:archive`.
- Następna zmiana: Etap 6 (punkt kontroli: zgoda na zastosowanie przygotowanej poprawki egzekwowana hookiem).

## Wynik eksperymentu (2.2), przebieg pierwszy

2026-10-27, Claude Code 2.1.300, sonnet: dziewięć „tak”, pytanie 10 „nie”, kod 1. Sesja 3 (32,7 s, 0,172 USD) zapisała sama: obserwację, podejrzenie, `change_explained` „Note greeting” wskazujące `Write` i `Edit` pliku `note.txt` (`hello there` → `greetings there`), sprawdzenie `passed` dla `grep -n greetings …` z dowodem `1:greetings there`. Dwie przyczyny „nie”, obie poza skillem: (1) ewaluator brał pierwsze sprawdzenie `passed` w zadaniu (dla `echo devguide-ok`) zamiast szukać sprawdzenia z `greetings` w wyjściu; (2) kontekst `SessionStart` dla nowej sesji (`startup`) podał pełny opis otwartego zadania z sesji 1 (listę dziewięciu kroków), więc agent wykonał je ponownie w zadaniu sesji 3, a dopiero potem swoje. Poprawki: ewaluator szuka dowolnego sprawdzenia `passed` z `greetings`; kontekst dla `startup` mówi o wcześniejszym zadaniu skrótowo i każe go nie kontynuować (design D2). Skill bez zmian.

## Wynik eksperymentu (2.2), przebieg drugi

2026-10-27 po poprawkach: dziewięć „tak”, pytanie 10 „nie”, kod 1. Kontekst dla nowej sesji zadziałał: sesja 3 (15,5 s, 0,093 USD) nie wykonała ponownie zadania sesji 1 i napisała, że nie dotyka wcześniejszego otwartego zadania. Zapisała sama obserwację, `change_explained` wskazujące `Write` i `Edit` pliku `note.txt` (`hello there` → `greetings there`) oraz sprawdzenie. Sprawdzenie ma status `unverified` (`no_execution`): agent zadeklarował w odpowiedzi, że uruchomił `grep -n greetings …` i zobaczył `1:greetings there`, ale surowy dziennik nie zawiera żadnego takiego wywołania Bash (ani odmowy). Agent zmyślił wykonanie weryfikacji, a dziennik to wychwycił i pokazał jako gołą deklarację. Dodatkowo agent napisał „no refusals or tool errors”, choć pierwsze polecenie (`cat` nieistniejącego pliku) zakończyło się błędem narzędzia. Poprawki bez zmiany kryteriów: `node process/cli.ts record` wypisuje od razu status zapisu (`status=unverified reason=no_execution: …`, `changes=…`, `confirmed=…`), skill każe przeczytać tę linię i przy `unverified` faktycznie uruchomić polecenie i zapisać ponownie; sesja 3 dostaje `grep`, `findstr` i `ls` w dozwolonych narzędziach.

## Wynik eksperymentu (2.2), przebieg trzeci

2026-10-27, Claude Code 2.1.300, sonnet: dziesięć „tak”, kod 0. Sesja 3: 16057 ms, 0,116 USD; zdarzenia: task_started, tool_failed (pierwsze `cat` nieistniejącego pliku), observation, file_changed ×2 (Write i Edit `note.txt`, `hello there` → `greetings there`), change_explained wskazujące obie zmiany, command_run `grep -c greetings …; cat …`, check `passed` z dowodem z wyjścia, agent_message, session_ended. Cały przebieg 0,38 USD (sesja 1 21,1 s, sesja 2 1,8 s). Raport: `.devguide/experiment/report.txt`.

## Wynik weryfikacji (4.1), część automatyczna

2026-10-27: serwer podglądu na `.devguide`, nowa sesja `claude -p --settings agent/experiment/settings.json` z zadaniem „utwórz `.devguide/scratch/greet.txt` z tekstem hello world, zamień hello na greetings, sprawdź, że plik zawiera greetings” (bez wymieniania poleceń DevGuide), historia próbkowana co 2 s z `/api/preview`. Sesja: 18,0 s, 8 tur, 0,116 USD, zadanie `20261027-1121-c9c9`. Historia przyrastała tak:

- t+2 s: „Zgłoszono zadanie”; stan „Agent pracuje · brak zapisanych sprawdzeń”; tylko zakładka „Przebieg”.
- t+6 s: krok „Narzędzie Bash zgłosiło błąd” (pierwsze `cat` nieistniejącego pliku, pokazane jako krok, bo jeszcze nie było ustaleń).
- t+8 s: obserwacja „greet.txt does not exist yet…” z przykładem (błąd narzędzia zwinął się do jej źródeł) oraz „Utworzono plik .devguide/scratch/greet.txt · Bez objaśnienia od AI”; pojawiła się zakładka „Kod AI”.
- t+10 s: po `Edit` krok zmiany bez objaśnienia obejmuje obie zmiany.
- t+14 s: objaśnienie „Create greet.txt and replace hello with greetings · 2 fragmenty kodu” zastąpiło krok bez objaśnienia.
- t+16 s: sprawdzenie „greet.txt contains the word greetings · przeszło”; stan „1 sprawdzenie potwierdza bieżący kod”; pojawiła się zakładka „Wyniki sprawdzeń”.
- koniec: stan „Sesja zakończona · 1 sprawdzenie potwierdza bieżący kod”.

Agent zmieniał plik tylko przez Write i Edit, sprawdzenie zapisał z poleceniem, które faktycznie uruchomił (`cat`), a w raporcie wymienił, czego nie sprawdzono. Jedna nieścisłość w raporcie: „I met no refusals or errors”, choć pierwsze polecenie zakończyło się błędem narzędzia (plik nie istniał); dziennik ma to zdarzenie. Stara sesja `20261021-2226-2fbb` (z `sed`) pokazuje kroki odtworzone z poleceń (wynik 10.5 w `stage-4-local-preview`). Do zrobienia przez użytkownika: obejrzeć to samo w przeglądarce (`npm run preview`, potem sesja z hookami) i odhaczyć 4.1.
