# Proposal

## Why

Plan (`docs/devguide-plan.md`, „Etap 4 — lokalny podgląd”) wymaga podglądu aktualizowanego po nowych zdarzeniach, z trzema widokami: przebieg, kod AI i wyniki sprawdzeń. Dziś dziennik zadania z Etapu 3 da się czytać tylko w terminalu (`replay`, `status`), a przepływ „działanie agenta → zapis zdarzenia → aktualizacja podglądu”, który plan każe domknąć w pierwszej kolejności, kończy się na zapisie. Dziennik nie zna też pojęcia logicznej poprawki: ma zmiany plików z narzędzi i tekst propozycji, ale nie ma miejsca na objaśnienie, po co i jak zmieniono kod, więc zakładka „Kod AI” nie ma czego pokazać.

## What Changes

- **Lokalny serwer podglądu** w `process/`: `npm run preview` uruchamia proces HTTP na `localhost`, który czyta bieżące zadanie z katalogu danych (`DEVGUIDE_DIR` lub `.devguide/`), udostępnia je jako dane dla podglądu i powiadamia otwartą stronę o każdym nowym zdarzeniu oraz o rozpoczęciu nowego zadania. Bez bazy, bez kont, bez dostępu z sieci.
- **Podgląd w przeglądarce** w `ui/`: jedna strona, minimalistyczny ciemny motyw z jednym akcentem, trzy widoki przełączane zakładkami:
  - *Przebieg* — według makiety produktu: historia znaczących kroków po lewej (zgłoszenie zadania, obserwacja, podejrzenie i jego odrzucenie, propozycja, przygotowana poprawka, zmiana w kodzie, sprawdzenie, decyzja) i własny widok wybranego kroku po prawej z krótkim wyjaśnieniem i tylko tym konkretem, którego krok potrzebuje: przykład od AI, fragment przed/po, wynik sprawdzenia z dowodem, propozycja decyzji. Same polecenia nie są krokami; polecenia, wyjścia, komunikaty agenta, czasy i identyfikatory są w rozwijanych źródłach kroku, do którego prowadziły. Bez liczników zerowych i legend. Przyciski decyzji tylko przy przygotowanej poprawce, oznaczone jako demonstracja do czasu Etapu 6. Odrzucone podejrzenia pozostają w historii; brakujące informacje są nazwane, nie uzupełniane. (Kształt wynika z dwóch testów z 2026-10-22 i zrzutu makiety.)
  - *Kod AI* — jedna karta na logiczną poprawkę: lokalizacja w kodzie, fragment „przed poprawką” i „po poprawce” z zapisu narzędzia, cel i mechanizm, przykład działania, założenia i ograniczenia; zmiany plików bez objaśnienia pokazane osobno jako same obserwacje narzędzia; pełny diff dostępny na żądanie.
  - *Wyniki sprawdzeń* — co uruchomiono, jaki był wynik, czego dotyczy, jaki jest dowód z wyjścia i jakie są ograniczenia; sprawdzenia niepotwierdzone z powodem; sprawdzenia wykonane na wcześniejszej wersji kodu wyraźnie oznaczone wraz z listą plików zmienionych od tego czasu; polecenia uruchomione bez żadnego sprawdzenia widoczne osobno.
- **Dziennik zadania rozszerzony o objaśnienie poprawki**: nowy rodzaj zdarzenia `change_explained` (pochodzenie `agent`) z tytułem, celem, mechanizmem, założeniami i przykładem, wiązany przy zapisie z zarejestrowanymi zdarzeniami zmiany pliku (po plikach lub wskazanych identyfikatorach); objaśnienie bez pasującej zmiany jest zapisywane i pokazywane jako objaśnienie bez zarejestrowanej zmiany. Sprawdzenie dostaje opcjonalne pole ograniczeń. CLI `record` obsługuje oba.
- **Eksperyment** `npm run experiment` dostaje jeden krok więcej (agent objaśnia zmianę `hello.txt`) i jedno pytanie więcej: czy dane podglądu zbudowane z zadania eksperymentu zawierają kartę poprawki z fragmentem przed/po z narzędzia i objaśnieniem od agenta.

Poza zakresem:

- skill prowadzący, który każe agentowi zapisywać objaśnienia i sprawdzenia (Etap 5); w tej zmianie objaśnienia powstają tylko w eksperymencie i ręcznie przez CLI;
- punkt kontroli i zgoda użytkownika na zastosowanie poprawki (Etap 6); `change_prepared` jest pokazywane jako propozycja, nie jako coś, co czeka na decyzję;
- projekt demonstracyjny z prawdziwym błędem (Etap 7);
- automatyczne wykrywanie logicznych poprawek z samych zmian plików (podgląd grupuje zmiany tylko według objaśnień agenta);
- obserwowanie zmian wykonanych poza narzędziami Claude Code;
- przeglądanie wielu zadań w jednym interfejsie: podgląd pokazuje zadanie bieżące, inne zadanie wybiera się flagą przy uruchomieniu;
- otwieranie przeglądarki automatycznie, interaktywne sesje Claude Code w eksperymencie, testy w prawdziwej przeglądarce.

## Capabilities

### New Capabilities

- `preview-server`: lokalny proces, który udostępnia bieżące zadanie podglądowi i powiadamia go o nowych zdarzeniach oraz o zmianie bieżącego zadania.
- `preview-timeline`: widok „Przebieg” — historia zdarzeń prostym językiem z kontekstem i przykładami na żądanie, z rozróżnieniem pochodzenia i z zachowaną historią odrzuconych hipotez.
- `preview-code`: widok „Kod AI” — karty logicznych poprawek z fragmentami przed/po z narzędzia, objaśnieniem od AI, przykładem, założeniami i pełnym diffem.
- `preview-checks`: widok „Wyniki sprawdzeń” — co uruchomiono, wynik, dowód, ograniczenia, dezaktualizacja po zmianie kodu, polecenia bez sprawdzenia.

### Modified Capabilities

- `task-event-log`: nowy rodzaj zdarzenia agenta — objaśnienie poprawki wiązane z zarejestrowanymi zmianami plików — oraz opcjonalne ograniczenia w sprawdzeniu. Specyfikacja `task-event-log` pochodzi ze zmiany `stage-3-task-event-log`, która jest zaimplementowana i scalona, ale jeszcze niezarchiwizowana; delta w tej zmianie dodaje wymagania (ADDED), nie zmienia istniejących, więc nadaje się do scalenia niezależnie od kolejności archiwizacji. Archiwizacja Etapu 3 powinna poprzedzić archiwizację tej zmiany.

## Impact

- `process/`: nowe `server.ts` (HTTP, dane podglądu, powiadomienia), `preview-model.ts` (model widoków z listy zdarzeń: karty poprawek, stan sprawdzeń z dezaktualizacją, elementy przebiegu); `events.ts`, `task-log.ts`, `cli.ts`, `replay.ts` rozszerzone o `change_explained` i `limits`.
- `ui/`: `index.html`, arkusz stylów i skrypt renderujący model widoków w przeglądarce, z czystą funkcją renderowania testowaną w Node.
- `package.json`: skrypt `preview`. Żadnej nowej zależności: serwer na `node:http`, powiadomienia przez Server-Sent Events, obserwacja plików przez `node:fs`.
- `agent/experiment/run.ts`, `evaluate.ts`: nowy krok i nowe pytanie; koszt przebiegu rośnie o jedną turę modelu.
- Dokumentacja: nowy `docs/local-preview.md` (uruchomienie, widoki, skąd pochodzi każda informacja, ograniczenia), aktualizacja `docs/task-event-log.md` (nowy rodzaj, pole `limits`), `process/README.md`, `ui/README.md`, `README.md`, `CLAUDE.md`, `openspec/config.yaml`.
- Zgodność: istniejące pliki zadań bez `change_explained` i bez `limits` czytają się bez zmian; podgląd pokazuje wtedy zmiany plików jako obserwacje bez objaśnienia.
