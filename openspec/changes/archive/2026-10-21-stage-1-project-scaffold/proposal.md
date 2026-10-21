# Proposal

## Why

Repozytorium ma już README, instrukcje dla agenta i plan, ale nie ma miejsca na kod, wybranego stacku ani żadnego sprawdzenia, które powie, czy projekt jest w dobrym stanie. Bez tego każda kolejna zmiana (Etap 2 i dalej) musiałaby najpierw rozstrzygać te same pytania. Ta zmiana domyka **Etap 1** planu (`docs/devguide-plan.md`, „Etap 1 — repozytorium i zakres pierwszej wersji”): wybór stacku z uzasadnieniem, katalogi na cztery części projektu i podstawowe sprawdzenia uruchamiane lokalnie i w CI.

## What Changes

- Wybór i udokumentowanie stacku: Node.js 24 LTS + TypeScript uruchamiany bez kroku budowania, testy w `node:test`, bez frameworka UI na tym etapie. Uzasadnienie trafia do `docs/stack.md`.
- Szkielet katalogów odpowiadający częściom z planu, każdy z krótkim README mówiącym, czemu służy i który etap go wypełni:
  - `agent/` — integracja z Claude Code (hooki, skill prowadzący; Etapy 2, 5, 6);
  - `process/` — lokalny proces: zapis zdarzeń i serwowanie podglądu (Etapy 3, 4);
  - `ui/` — lokalny podgląd (Etap 4);
  - `demo/` — projekt demonstracyjny z błędem eksportu (Etap 7).
- Jedno polecenie sprawdzające cały projekt (`npm run check`), które łączy: sprawdzenie typów, testy, sprawdzenie linków względnych w Markdown i `openspec validate`. Każde z nich dostępne też osobno.
- Workflow GitHub Actions uruchamiający to samo polecenie na push i pull request.
- Aktualizacja `README.md` (wymagania, uruchamianie sprawdzeń, układ katalogów) i `CLAUDE.md` (układ katalogów, stack, polecenie sprawdzające).

**Poza zakresem**:

- jakakolwiek faktyczna integracja z Claude Code (hooki, skill) — to Etap 2;
- zapis zdarzeń, podgląd, projekt demonstracyjny z błędem — Etapy 3, 4, 7; katalogi dostają wyłącznie README;
- linter stylu kodu (ESLint, Prettier) — dodamy, gdy pojawi się kod, który ma czego pilnować;
- publikacja zdalnego repozytorium, konfiguracja ochrony gałęzi, wydania;
- konta, chmura, zespoły, wielu agentów (wykluczone przez plan).

## Capabilities

### New Capabilities

- `project-checks`: jedno polecenie i jedno zadanie CI, które mówią deweloperowi, czy repozytorium jest w spójnym stanie (typy, testy, linki w dokumentacji, artefakty OpenSpec), i wskazują, co jest zepsute.

### Modified Capabilities

Brak — to pierwsza zmiana w projekcie, `openspec/specs/` jest puste.

## Impact

- Nowe pliki w katalogu głównym: `package.json`, `package-lock.json`, `tsconfig.json`, `.github/workflows/ci.yml`, `scripts/` (skrypt sprawdzający linki), `docs/stack.md`.
- Nowe katalogi `agent/`, `process/`, `ui/`, `demo/` z README.
- Zmienione: `README.md`, `CLAUDE.md`, `.gitignore` (bez zmian w zasadach, tylko jeśli okaże się potrzebny wpis dla artefaktów testów), `openspec/config.yaml` (dopisanie stacku i polecenia sprawdzającego do kontekstu).
- Zależności deweloperskie: `typescript`, `@types/node`, `@fission-ai/openspec`. Brak zależności produkcyjnych.
- Wymaganie środowiska rośnie z Node 20.19 do Node 24 (README to odnotuje).
- Brak wpływu na istniejące zachowanie, bo nie ma jeszcze żadnego kodu.
