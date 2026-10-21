# Proposal

## Why

Plan (`docs/devguide-plan.md`, „Etap 2 — sprawdzenie możliwości integracji”) zabrania projektowania dalszej architektury na niezweryfikowanych założeniach. Etapy 3–6 (zapis zdarzeń, podgląd, skill prowadzący, punkt kontroli) zależą od pięciu pytań o Claude Code: jak uruchomić skill, jak odbierać informacje o działaniach agenta, jak rejestrować zmiany plików i wyniki poleceń, czy da się zatrzymać konkretną operację przed wykonaniem, jak wznowić zadanie po przerwaniu sesji. Dziś odpowiedzi pochodzą wyłącznie z lektury dokumentacji (notatka w `openspec/config.yaml`). Ta zmiana zamienia je w fakty potwierdzone działającym kodem w tym repozytorium, na konkretnej wersji Claude Code.

## What Changes

- **Hooki rejestrujące działania agenta.** Jeden skrypt hooka w `agent/hooks/`, podpięty pod zdarzenia `SessionStart`, `PreToolUse`, `PostToolUse`, `Stop` i `SessionEnd`, dopisuje każde zdarzenie jako wiersz JSON do lokalnego pliku dziennika w katalogu roboczym repozytorium (poza Git). Dla zmian plików zapisuje ścieżkę, dla poleceń — treść polecenia i wynik zwrócony przez narzędzie, dla każdego zdarzenia — czas, identyfikator sesji i bieżącą wersję kodu (commit).
- **Realne zatrzymanie jednej operacji.** Hook `PreToolUse` odmawia wykonania ściśle określonego polecenia (polecenie Bash zawierające umówiony znacznik) i zapisuje odmowę do dziennika. Zakres jest celowo wąski i nazwany: to dowód, że mechanizm blokady działa, a nie punkt kontroli produktu (ten powstaje w Etapie 6).
- **Minimalny skill `/devguide`.** Plik `SKILL.md` uruchamiany przez `/devguide`, który na tym etapie robi tylko jedno: potwierdza aktywację i zostawia w dzienniku ślad, że zadanie zostało rozpoczęte tym wejściem. Treść prowadząca zadanie powstaje w Etapie 5.
- **Powtarzalny eksperyment.** Skrypt w `agent/experiment/`, który uruchamia Claude Code nieinteraktywnie (tryb `-p`) z hookami i skillem, prosi agenta o wykonanie przewidywalnych akcji (zapis pliku, polecenie, próba uruchomienia blokowanego polecenia), kończy sesję, wznawia ją przez `--resume` i sprawdza w dzienniku oraz na dysku, że każde z pięciu pytań ma odpowiedź „tak, działa” lub „nie działa, bo…”. Skrypt wypisuje czytelny raport i kończy się kodem 0 tylko wtedy, gdy wszystkie sprawdzenia przeszły.
- **Testy jednostkowe hooka** uruchamiane przez `npm run check` (bez Claude Code i bez sieci): podają na stdin przykładowe zdarzenia i sprawdzają wiersz dziennika, kod wyjścia i odpowiedź blokady.
- **Dokument ustaleń** `docs/claude-code-integration.md`: dla każdego z pięciu pytań — odpowiedź, jak ją potwierdzono (polecenie, wersja Claude Code, data), ograniczenia i konsekwencje dla Etapów 3–6. Aktualizacja `agent/README.md`, `CLAUDE.md` (stan projektu) i kontekstu w `openspec/config.yaml` (z „zweryfikowane w dokumentacji” na „potwierdzone eksperymentem”).

**Poza zakresem**:

- właściwy format i model zdarzeń (obserwacja, hipoteza, decyzja, sprawdzenie) — Etap 3; dziennik z tej zmiany zapisuje surowe zdarzenia narzędzi i będzie zastąpiony lub rozszerzony;
- podgląd i serwer lokalny — Etap 4;
- treść skilla prowadzącego (rozpoznanie, planowanie, implementacja, weryfikacja, wyjaśnianie) — Etap 5;
- punkt kontroli „użytkownik zatwierdza poprawkę” i zgoda powiązana z zawartością — Etap 6; tu powstaje tylko dowód, że zatrzymanie przed wykonaniem jest technicznie egzekwowalne;
- uruchamianie eksperymentu w CI (wymaga zalogowanego Claude Code i zużywa tokeny); CI uruchamia tylko testy jednostkowe hooka;
- pakowanie integracji jako wtyczki Claude Code lub instalacja w obcym repozytorium — rozważymy, gdy eksperyment pokaże, co jest potrzebne;
- obsługa innych agentów niż Claude Code.

## Capabilities

### New Capabilities

- `agent-activity-log`: lokalny dziennik, w którym integracja z Claude Code zapisuje co agent zrobił (start i koniec sesji, wznowienie, każde użycie narzędzia, zmiany plików, polecenia i ich wyniki) z czasem, sesją i wersją kodu — bez udziału agenta w opisywaniu własnych działań.
- `operation-block`: zatrzymanie ściśle określonej operacji agenta zanim zostanie wykonana, z zapisem odmowy w dzienniku; podstawa pod punkt kontroli z Etapu 6.
- `task-entry-point`: jedno wejście `/devguide`, którym użytkownik rozpoczyna zadanie w Claude Code; jego użycie jest widoczne w dzienniku.

### Modified Capabilities

Brak. `project-checks` nie zmienia wymagań: testy hooka są zwykłymi plikami `*.test.ts`, które istniejące polecenie sprawdzające już obejmuje.

## Impact

- Nowe pliki: `agent/hooks/` (skrypt hooka i jego testy), `agent/experiment/` (skrypt eksperymentu i plik ustawień z konfiguracją hooków), `.claude/skills/devguide/SKILL.md`, `docs/claude-code-integration.md`.
- Zmienione: `.gitignore` (katalog dziennika), `agent/README.md`, `CLAUDE.md`, `README.md` (jak uruchomić eksperyment), `openspec/config.yaml` (kontekst integracji), `docs/stack.md` tylko jeśli pojawi się różnica między Windows a Linux w uruchamianiu hooków.
- Konfiguracja hooków jest ładowana wyłącznie na czas eksperymentu (plik ustawień podawany do Claude Code przy uruchomieniu), więc codzienna praca nad DevGuide w Claude Code nie zmienia się i nie zaśmieca dziennika. Skill `/devguide` jest widoczny w każdej sesji w tym repozytorium, ale nic nie robi, dopóki nie zostanie wywołany.
- Brak nowych zależności: hook i eksperyment używają wyłącznie modułów wbudowanych Node (`node:fs`, `node:child_process`, `node:test`).
- Wymaganie środowiska dla eksperymentu (nie dla `npm run check`): zainstalowany i zalogowany Claude Code w wersji, na której wykonano potwierdzenie (zapisanej w dokumencie ustaleń). Przebieg zużywa tokeny.
- Wynik eksperymentu może być negatywny dla któregoś pytania (np. blokada nie działa w trybie, w którym ją testujemy). Wtedy dokument ustaleń opisuje ograniczenie i wykonalny wariant, zgodnie z Etapem 6 planu, a kolejne zmiany planuje się na tej podstawie.
