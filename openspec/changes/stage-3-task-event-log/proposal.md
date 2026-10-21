# Proposal

## Why

Plan (`docs/devguide-plan.md`, „Etap 3 — zapis przebiegu zadania”) wymaga prostego zapisu zdarzeń i załączonych materiałów: obserwacji problemu, hipotez i ich losu, propozycji, przygotowanych i zastosowanych zmian, decyzji użytkownika oraz wykonanych sprawdzeń z wynikiem, z pochodzeniem, czasem, powiązanymi plikami i wersją kodu. Dziś istnieje tylko surowy dziennik zdarzeń hooków z Etapu 2 (`.devguide/events.jsonl`): pełne ładunki narzędzi bez pojęcia zadania, bez miejsca na ustalenia agenta i bez reguł, które odróżniają wynik sprawdzenia od opinii AI. Ta zmiana wprowadza docelowy dziennik zadania, na którym Etap 4 zbuduje podgląd, Etap 5 skill prowadzący, a Etap 6 punkt kontroli.

## What Changes

- **Dziennik zadania** w `process/`: jedno zadanie DevGuide (od `/devguide` do końca) ma własny katalog w `.devguide/tasks/<id>/` z plikiem zdarzeń JSONL, dopisywanym wyłącznie na końcu. Każde zdarzenie ma identyfikator, czas, pochodzenie (`user`, `tool`, `agent`, `devguide`), wersję kodu (commit oraz odcisk drzewa roboczego, bo zmiany agenta są niezatwierdzone), powiązane pliki i rodzaj. Rodzaje: rozpoczęcie zadania, wypowiedź użytkownika, wznowienie sesji, obserwacja, hipoteza, rozstrzygnięcie hipotezy, propozycja, przygotowana zmiana, zmiana pliku, uruchomione polecenie, nieudane narzędzie, decyzja użytkownika, sprawdzenie, komunikat agenta.
- **Zdarzenia z narzędzi** powstają w hooku z Etapu 2 na podstawie potwierdzonych kształtów `PostToolUse` (ścieżka i fragment przed/po dla `Write`/`Edit`, treść i wynik dla `Bash`) oraz `UserPromptSubmit`, `SessionStart` i `Stop`. Surowy dziennik hooków zostaje bez zmian jako pełny ślad.
- **Kanał ustaleń agenta**: polecenie `node process/cli.ts record <rodzaj> ...`, którym agent (od Etapu 5 — skill) zapisuje obserwację, hipotezę, rozstrzygnięcie, propozycję, przygotowaną zmianę, decyzję użytkownika i sprawdzenie. Materiały podane przez agenta są zawsze oznaczone jako ilustracja; rzeczywiste wyniki pochodzą tylko ze zdarzeń narzędzi.
- **Reguły, które dziennik egzekwuje przy zapisie**, nie przez instrukcję w prompcie: status „sprawdzenie przeszło” powstaje wyłącznie, gdy sprawdzenie wskazuje zarejestrowane wykonanie polecenia w tym zadaniu, a cytowany dowód występuje w jego zapisanym wyniku; w przeciwnym razie zapis zostaje, ale ze statusem „niepotwierdzone”. Decyzja użytkownika jest oznaczana jako potwierdzona tylko, gdy cytowana odpowiedź występuje w zapisanej wypowiedzi użytkownika. Rozstrzygnięcie hipotezy to nowe zdarzenie, nigdy edycja starego.
- **Odtworzenie i wznowienie**: `node process/cli.ts replay` wypisuje przebieg zadania prostym językiem (z identyfikatorami w szczegółach i wersją JSON dla Etapu 4), w tym stan hipotez, listę sprawdzeń i oznaczenie, że kod zmienił się po sprawdzeniu. Przy starcie i wznowieniu sesji z otwartym zadaniem hook przekazuje agentowi krótki kontekst zadania (`additionalContext` w `SessionStart`), co eksperyment ma potwierdzić.
- **Testy i eksperyment**: testy jednostkowe modelu, zapisu, odczytu, CLI i integracji z hookiem w `npm run check`; rozszerzenie `npm run experiment` o kroki, w których agent zapisuje ustalenia i sprawdzenie, a po wznowieniu zna kontekst zadania.
- **Dokumentacja**: `docs/task-event-log.md` (format zdarzeń, katalogi, reguły statusów), aktualizacja `process/README.md`, `agent/README.md`, `README.md`, `CLAUDE.md`, `openspec/config.yaml` i `docs/claude-code-integration.md` (wynik dla `additionalContext`).

**Poza zakresem**:

- podgląd w przeglądarce i serwer odświeżający widok — Etap 4; ta zmiana daje tylko odczyt w terminalu i jako JSON;
- treść skilla prowadzącego, który będzie używał kanału ustaleń — Etap 5; tu agent wywołuje polecenie tylko na wyraźne życzenie zadania w eksperymencie;
- zatrzymanie zastosowania zmiany do czasu zgody użytkownika i wiązanie zgody z zawartością — Etap 6; zdarzenie „decyzja” jest tu tylko zapisem;
- karty poprawek z objaśnieniami „przed/po” — Etap 4; tu zapisywane są surowe fragmenty z narzędzi;
- wiele równoległych zadań, zadania w obcym repozytorium i instalacja hooków poza eksperymentem — późniejsze etapy;
- obsługa zdarzeń subagentów i narzędzi MCP — zapisywane w surowym dzienniku, nieprzekładane na zdarzenia zadania.

## Capabilities

### New Capabilities

- `task-event-log`: zapis przebiegu jednego zadania DevGuide jako ciągu zdarzeń z pochodzeniem, czasem, plikami i wersją kodu; zdarzenia z narzędzi (zmiany plików, polecenia, wypowiedzi użytkownika) oraz ustalenia agenta (obserwacja, hipoteza, propozycja, przygotowana zmiana, decyzja, sprawdzenie) zapisywane poleceniem; reguły statusu sprawdzenia i potwierdzenia decyzji egzekwowane przy zapisie.
- `task-replay`: odczyt dziennika zadania dla człowieka i dla agenta: przebieg prostym językiem, stan hipotez i sprawdzeń z oznaczeniem dezaktualizacji po zmianie kodu, wersja JSON dla podglądu oraz kontekst zadania przekazywany agentowi przy starcie i wznowieniu sesji.

### Modified Capabilities

Brak. `agent-activity-log` zachowuje surowy dziennik bez zmian wymagań; `task-entry-point` nadal zapisuje rozpoczęcie przez `/devguide`, a otwarcie zadania opisuje nowa specyfikacja `task-event-log`. `project-checks` obejmuje nowe testy istniejącym wzorcem `process/**/*.test.ts`.

## Impact

- Nowe pliki: `process/` (model zdarzeń, zapis i odczyt dziennika zadania, odcisk wersji kodu, `cli.ts`, testy), `docs/task-event-log.md`.
- Zmienione: `agent/hooks/record-event.ts` (po zapisie surowego wpisu wywołuje zapis do dziennika zadania; `SessionStart` zwraca kontekst zadania), jego testy, `agent/experiment/settings.json` (bez zmian w zdarzeniach, ale `DEVGUIDE_DIR` zastępuje `DEVGUIDE_LOG_FILE`), `agent/experiment/run.ts` i `evaluate.ts` (nowe kroki i kryteria), `.claude/skills/devguide/SKILL.md` tylko jeśli eksperyment tego wymaga (jedno zdanie o poleceniu zapisu), `process/README.md`, `agent/README.md`, `README.md`, `CLAUDE.md`, `openspec/config.yaml`, `docs/claude-code-integration.md`.
- Brak nowych zależności: moduły wbudowane Node (`node:fs`, `node:crypto`, `node:child_process`, `node:util` dla `parseArgs`, `node:test`).
- Koszt czasu: zdarzenia zadania wymagają odcisku drzewa roboczego (kilka wywołań `git`), liczonego tylko wtedy, gdy powstaje zdarzenie zadania, nie przy każdym użyciu narzędzia; eksperyment podaje zmierzony narzut.
- Eksperyment nadal wymaga zalogowanego Claude Code i zużywa tokeny (ok. 0,3 USD po rozszerzeniu); CI uruchamia tylko testy.
- Ryzyko wyniku negatywnego: jeśli `additionalContext` w `SessionStart` nie dotrze do agenta, dziennik i `replay` działają bez niego, a dokument ustaleń opisuje ograniczenie i wariant (skill wywołuje `replay` sam na początku — Etap 5).
