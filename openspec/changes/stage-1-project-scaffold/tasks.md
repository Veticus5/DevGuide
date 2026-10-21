# Tasks

## 1. Środowisko Node i TypeScript

- [x] 1.1 Dodać `package.json` (nazwa `devguide`, `private: true`, `type: module`, `engines.node >=24`) z devDependencies `typescript`, `@types/node`, `@fission-ai/openspec` oraz `.nvmrc` z `24`; zweryfikować, że `npm install` kończy się bez błędów i powstaje `package-lock.json`.
- [x] 1.2 Dodać `tsconfig.json` (ESM, `module: nodenext`, `strict`, `noEmit`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `allowImportingTsExtensions`, `include` obejmujące `agent/`, `process/`, `ui/`, `demo/`, `scripts/`); zweryfikować, że `npx tsc --noEmit` przechodzi na pustym projekcie.
- [x] 1.3 Sprawdzić, że `.gitignore` pokrywa `node_modules/` i nie trzeba nic dodawać; zweryfikować przez `git status --short`, który nie pokazuje `node_modules/`.

## 2. Katalogi projektu

- [x] 2.1 Utworzyć `agent/README.md`, `process/README.md`, `ui/README.md`, `demo/README.md`, każdy z jednym H1 zgodnym z nazwą katalogu, jednym akapitem o odpowiedzialności i wskazaniem etapu planu, który go wypełni; zweryfikować, że cztery pliki istnieją i każdy linkuje względnie do `docs/devguide-plan.md`.
- [x] 2.2 Utworzyć `docs/stack.md` z uzasadnieniem stacku (Node 24 + TypeScript bez budowania, `node:test`, jeden `package.json`, własny skrypt linków, GitHub Actions) w formie 2–3 akapitów i tabeli „co / dlaczego / alternatywa”, wraz z zasadą „tylko składnia usuwalna przez Node”; zweryfikować, że plik renderuje się poprawnie i ma jeden H1.

## 3. Sprawdzenie linków w Markdown

- [x] 3.1 Napisać `scripts/check-links.ts`: rekurencyjne wyszukiwanie plików `.md` z pominięciem `node_modules/` i `.git/`, wyciąganie linków `[tekst](cel)`, pomijanie celów z protokołem, `mailto:` i samych kotwic, odcinanie kotwicy od ścieżki, sprawdzanie istnienia celu względem pliku źródłowego, wypisanie `plik -> cel` dla brakujących i kod wyjścia 1, gdy cokolwiek brakuje; zweryfikować, że `node scripts/check-links.ts` na bieżącym repozytorium kończy się kodem 0.
- [x] 3.2 Napisać `scripts/check-links.test.ts` (`node:test`, katalog tymczasowy) pokrywający: link do istniejącego pliku, link do katalogu, link z kotwicą do istniejącego pliku, link zewnętrzny, sama kotwica, link do brakującego pliku zgłaszany z nazwą źródła i celem; zweryfikować, że `node --test scripts/` przechodzi i że celowe zepsucie jednego przypadku powoduje jego niepowodzenie.

## 4. Polecenie sprawdzające

- [x] 4.1 Dodać do `package.json` skrypty `check:types`, `check:test`, `check:links`, `check:specs` i `check` (sekwencja czterech poprzednich przez `&&`); zweryfikować, że każdy z osobna działa i że `npm run check` kończy się kodem 0.
- [x] 4.2 Sprawdzić zachowanie przy błędzie: tymczasowo dodać do dowolnego pliku `.md` link do nieistniejącego pliku, uruchomić `npm run check`, potwierdzić kod wyjścia różny od 0 i komunikat z nazwą pliku i celem, po czym cofnąć zmianę; zweryfikować przez `git status --short`, że nic tymczasowego nie zostało.

## 5. CI

- [x] 5.1 Dodać `.github/workflows/ci.yml`: wyzwalacze `push` na `main` i `pull_request`, `ubuntu-latest`, `actions/checkout`, `actions/setup-node` z `node-version-file: .nvmrc` i `cache: npm`, `npm ci`, `npm run check`; zweryfikować składnię YAML przez wczytanie pliku skryptem (np. `node -e` z parserem lub `python -c "import yaml"`) i brak sekretów oraz adresów wewnętrznych w pliku.
- [ ] 5.2 Po wypchnięciu gałęzi potwierdzić w GitHub, że zadanie CI uruchomiło się i przeszło (`gh run list --branch <gałąź>` lub zakładka Actions); jeśli repozytorium nie jest jeszcze wypchnięte, odnotować to w podsumowaniu zmiany jako sprawdzenie odłożone.

## 6. Dokumentacja projektu

- [x] 6.1 Zaktualizować `README.md`: wymaganie Node 24, instalacja przez `npm install`, sekcja „Sprawdzenia” z `npm run check` i czterema poleceniami składowymi, układ repozytorium z nowymi katalogami, link do `docs/stack.md`; zweryfikować przez `npm run check:links`.
- [x] 6.2 Zaktualizować `CLAUDE.md`: układ repozytorium (nowe katalogi i `scripts/`), stack i zasada składni usuwalnej, `npm run check` jako obowiązkowe sprawdzenie przed zakończeniem zmiany; zaktualizować `openspec/config.yaml` (kontekst: stack i polecenie sprawdzające); zweryfikować przez `npm run check`.

## 7. Weryfikacja ręczna przyrostu

- [x] 7.1 Na świeżym klonie (lub po `git clean -fdx` w kopii katalogu, nie w repozytorium roboczym) z Node 24 wykonać `npm ci` i `npm run check`; potwierdzić kod wyjścia 0, obecność czterech katalogów z README, `docs/stack.md`, i że `openspec validate --all` przechodzi dla tej zmiany. Zapisać wynik (wersja Node, czas, wyjście polecenia) w podsumowaniu zmiany.

## Workflow follow-up

- Po przeglądzie przez użytkownika: `/opsx:verify`, potem `/opsx:archive`, które przeniesie spec `project-checks` do `openspec/specs/`.
- Następna zmiana: Etap 2 (eksperyment z hookami i skillem Claude Code).
