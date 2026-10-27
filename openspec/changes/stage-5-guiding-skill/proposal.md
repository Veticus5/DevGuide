# Proposal

## Why

Plan (`docs/devguide-plan.md`, „Etap 5 — skill prowadzący”) wymaga jednego skillu, który prowadzi zadanie i przekazuje ustrukturyzowane ustalenia do lokalnego procesu. Test podglądu z 2026-10-22 pokazał skutek jego braku: w sesji użytkownika (`/devguide Zmień słowo hello na greetings…`) agent nie zapisał żadnego ustalenia, zmienił plik przez `sed` zamiast narzędziem Edit, a dziennik dostał trzy `command_run` i komunikat. Przyczyna ustalona z dziennika i z repozytorium: skill `/devguide` z Etapu 2 mówi agentowi „you do not need to describe your actions” i nie wspomina o `node process/cli.ts record`; zapis (CLI) i odczyt (model, strona) działają, co potwierdza eksperyment (9/9). Podgląd może pokazać tylko to, co agent zapisze, więc bez tej zmiany historia zadania nie przyrasta w trakcie pracy.

## What Changes

- **Skill `/devguide` prowadzi zadanie** zamiast tylko potwierdzać tryb. Instrukcja każe agentowi: zacząć od obserwacji (co odtworzono lub zobaczono, z przykładem), zapisywać podejrzenie przed jego sprawdzaniem i rozstrzygać je po sprawdzeniu, zmieniać pliki wyłącznie narzędziami Write i Edit, po każdej logicznej poprawce zapisać objaśnienie (`change_explained` z celem, mechanizmem, założeniami, przykładem), po każdym poleceniu weryfikującym zapisać sprawdzenie z dokładnie tym poleceniem, cytatem z wyjścia i ograniczeniami, a gdy użytkownik odpowiada na pytanie, zapisać decyzję z jego słowami. Instrukcja mówi też, czego nie robić: nie zapisywać sprawdzenia dla polecenia, które nie sprawdza zachowania produktu (`echo done` potwierdza tylko wypisanie tekstu), nie deklarować „przeszło” bez dowodu z wyjścia, nie wymyślać wyników.
- **Minimalny zakres instrukcji**: pięć obszarów z planu (rozpoznanie problemu, planowanie, implementacja, weryfikacja, wyjaśnianie) w jednym pliku skillu, po jednym akapicie z poleceniami CLI do skopiowania; bez osobnych agentów i bez dodatkowych plików.
- **Kontekst przy starcie sesji** (`additionalContext` z hooka) przypomina te same zasady w trzech zdaniach, żeby wznowiona sesja zachowywała się tak samo.
- **Eksperyment** dostaje trzecią sesję: nowe zadanie podane naturalnie („utwórz plik, zamień słowo, sprawdź wynik”), bez wymieniania poleceń CLI; dziesiąte pytanie: czy agent sam zapisał obserwację, objaśnienie powiązane ze zmianą pliku wykonaną narzędziem Edit i sprawdzenie ze statusem `passed`.

Poza zakresem:

- punkt kontroli i zgoda na zastosowanie poprawki (Etap 6); skill prosi o decyzję, ale nic jej nie egzekwuje;
- szczegółowe procedury dla rodzajów projektów (backend, frontend, dane) i integracja z OpenSpec projektu użytkownika;
- automatyczne wykrywanie logicznych poprawek bez objaśnienia agenta;
- zmiany w podglądzie (osobna zmiana `stage-4-local-preview`, grupa 10).

## Capabilities

### New Capabilities

- `guiding-skill`: zachowanie agenta w trybie DevGuide: co i kiedy zapisuje w dzienniku zadania, jakich narzędzi używa do zmian w kodzie i czego nie wolno mu zapisywać.

### Modified Capabilities

- `task-entry-point`: wymaganie „Użytkownik rozpoczyna zadanie jednym poleceniem” zmienia odpowiedź agenta: po potwierdzeniu trybu agent zaczyna prowadzić zadanie według skillu zamiast „po prostu wykonać zadanie”.

## Impact

- `.claude/skills/devguide/SKILL.md`: przepisany (treść prowadząca, polecenia CLI, zakazy).
- `process/replay.ts`: `sessionContext` rozszerzony o trzy zdania zasad (odbiorcą jest agent, po angielsku).
- `agent/experiment/run.ts`, `evaluate.ts`, `run.test.ts`: trzecia sesja i dziesiąte pytanie; koszt przebiegu rośnie o jedną sesję (ok. 0,2 USD).
- Dokumentacja: `docs/claude-code-integration.md` (wynik dla pytania 10, wiersz „Consequences” dla Etapu 5), `docs/task-event-log.md` (odsyłacz do skillu jako źródła ustaleń), `README.md`, `CLAUDE.md`, `openspec/config.yaml`.
- Zgodność: dziennik, CLI i podgląd bez zmian; stare zadania czytają się jak dotąd.
