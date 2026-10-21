# Design

## Context

Repozytorium zawiera tylko dokumentację: plan (`docs/devguide-plan.md`), `README.md`, `CLAUDE.md`, konfigurację OpenSpec i Claude Code. Nie ma żadnego kodu ani narzędzi. Motywacja: zobacz `proposal.md` — Why.

Ograniczenia, które kształtują wybór stacku:

- Claude Code uruchamia hooki jako zwykłe procesy, które dostają JSON na stdin i odpowiadają kodem wyjścia lub JSON-em na stdout. Integracja (Etap 2) musi więc być tanim w uruchomieniu skryptem, nie usługą.
- Lokalny proces (Etapy 3–4) ma przyjmować zdarzenia z hooków i na bieżąco odświeżać podgląd w przeglądarce. Wystarczy prosty serwer HTTP z pushem do przeglądarki.
- Pierwsza wersja: jeden użytkownik, jedno zadanie, jedno repozytorium. Nie trzeba skalować, uwierzytelniać ani wdrażać.
- Node.js jest już wymagany przez OpenSpec CLI, więc nie dodaje nowego środowiska.
- Repozytorium jest publiczne; sprawdzenia nie mogą wymagać sekretów.

## Goals / Non-Goals

**Goals:**

- Jedno środowisko uruchomieniowe dla hooków, lokalnego procesu, podglądu i projektu demonstracyjnego.
- Zero kroku budowania w pętli deweloperskiej: edycja pliku, uruchomienie, wynik.
- Sprawdzenia, które da się uruchomić lokalnie i w CI tym samym poleceniem i które nie zależą od żadnego kodu, którego jeszcze nie ma.
- Układ katalogów, który odpowiada częściom projektu z planu, żeby kolejne zmiany miały oczywiste miejsce.

**Non-Goals:**

- Wybór biblioteki UI, formatu zapisu zdarzeń czy protokołu między hookami a procesem. Te decyzje należą do Etapów 2–4 i mają wynikać z eksperymentu, nie z założeń.
- Monorepo z osobnymi pakietami npm na katalog. Dopóki części nie mają własnych zależności, jeden `package.json` wystarczy.
- Linter stylu i formatowanie automatyczne.

## Decisions

### D1. Node.js 24 LTS + TypeScript bez kroku budowania

Kod pisany w TypeScript i uruchamiany bezpośrednio przez `node plik.ts` (natywne usuwanie typów, dostępne bez flag od Node 22.18 / 24). `tsc --noEmit` służy wyłącznie do sprawdzania typów. W `tsconfig.json` ustawiamy `erasableSyntaxOnly`, `verbatimModuleSyntax` i `allowImportingTsExtensions`, żeby kod, który przechodzi typowanie, na pewno dał się uruchomić w Node bez transpilacji.

Dlaczego: hooki Claude Code muszą startować szybko i bez instalacji globalnych narzędzi; Node już jest wymagany; brak kroku budowania usuwa całą klasę problemów „zbudowane vs. źródłowe”. TypeScript daje typy dla formatu zdarzeń, co będzie ważne od Etapu 3.

Alternatywy:

- **Python**: równie prosty dla hooków, ale podgląd w przeglądarce i tak wymaga JS, więc byłyby dwa środowiska.
- **Go / Rust**: jeden plik binarny byłby wygodny do dystrybucji, ale wymaga kroku budowania i jest cięższy do iteracji przy UI; pierwsza wersja nie potrzebuje dystrybucji.
- **TypeScript z bundlerem (tsx, esbuild, Vite)**: dodaje zależność i krok, który w Node 24 nie jest już potrzebny. Jeśli Etap 4 uzna, że UI potrzebuje bundlera, dodamy go lokalnie w `ui/`.
- **Czysty JavaScript**: mniej narzędzi, ale brak typów utrudni utrzymanie formatu zdarzeń, który jest sercem projektu.

Konsekwencja: wymaganie Node rośnie z 20.19 do 24 (aktualne LTS). `engines.node` w `package.json`, `.nvmrc` i README to odnotują.

### D2. Testy w `node:test`, bez frameworka

Wbudowany runner (`node --test`) z asercjami z `node:assert/strict`. Pliki testowe obok kodu: `*.test.ts`.

Dlaczego: zero zależności, natywne wsparcie dla `.ts`, wystarczające raportowanie. Vitest i Jest odrzucone jako niepotrzebne na tym etapie; można je dodać później bez zmiany układu plików.

### D3. Jeden `package.json` w katalogu głównym, katalogi tematyczne zamiast pakietów

Układ:

```text
agent/      integracja z Claude Code (hooki, skill)      <- Etapy 2, 5, 6
process/    lokalny proces: zapis zdarzeń, serwer        <- Etapy 3, 4
ui/         lokalny podgląd                              <- Etap 4
demo/       projekt demonstracyjny z błędem eksportu     <- Etap 7
scripts/    skrypty sprawdzające i pomocnicze dla repo
docs/       plan i dokumentacja
openspec/   specyfikacje i zmiany
```

Każdy z czterech katalogów projektu dostaje `README.md` z jednym akapitem: za co odpowiada i który etap go wypełnia. W tej zmianie nie ma w nich kodu.

Dlaczego nie npm workspaces: katalogi są puste, a wspólny `tsconfig.json` i jedna lista zależności są prostsze. Jeśli `demo/` będzie potrzebował udawać „obce” repozytorium z własnym `package.json` (prawdopodobne w Etapie 7), wtedy go wydzielimy. Ta decyzja należy do tamtej zmiany.

### D4. Skrypt `check` jako sekwencja czterech niezależnych skryptów npm

W `package.json`:

- `check:types`: `tsc --noEmit`;
- `check:test`: `node --test` z wzorcem obejmującym `agent/`, `process/`, `ui/`, `demo/` i `scripts/`;
- `check:links`: `node scripts/check-links.ts`, własny skrypt (około 80 linii). Przechodzi pliki `.md` poza `node_modules/`, wyciąga linki Markdown w formie `[tekst](cel)`, pomija cele z protokołem, `mailto:` i same kotwice, odcina kotwicę od ścieżki, sprawdza istnienie celu względem pliku źródłowego, wypisuje `plik -> cel` dla każdego brakującego i kończy się kodem 1, jeśli czegoś brakuje;
- `check:specs`: `openspec validate --all`;
- `check`: uruchamia powyższe po kolei (`npm run check:types && npm run check:test && ...`), więc zatrzymuje się na pierwszym błędzie i wyraźnie pokazuje, który krok zawiódł.

Dlaczego własny skrypt do linków zamiast `markdown-link-check` lub `lychee`: potrzebujemy tylko linków względnych i zero sieci; zależność zewnętrzna byłaby większa niż skrypt. Skrypt ma własny test w `scripts/check-links.test.ts` na katalogu tymczasowym. To jedyny prawdziwy kod w tej zmianie i jedyny test, więc `check:test` nie jest pusty.

`openspec validate --all` wymaga CLI; dodajemy `@fission-ai/openspec` jako devDependency, żeby CI i świeży klon miały tę samą wersję co osoba, która pisze zmiany. Globalna instalacja z README pozostaje opcjonalna dla wygody.

### D5. CI: GitHub Actions, jedno zadanie

`.github/workflows/ci.yml`: wyzwalacze `push` na `main` i `pull_request`; `ubuntu-latest`; `actions/setup-node` z wersją z `.nvmrc` i cache npm; `npm ci`; `npm run check`. Jedno zadanie, bo sprawdzenia trwają sekundy i osobne zadania nie dałyby nic poza szumem.

Dlaczego nie macierz systemów: deweloper pracuje na Windows, CI na Linuksie; różnice (ścieżki, końce linii) wyłapie `check:links` i `.gitattributes` z `eol=lf`. Macierz dodamy, jeśli pojawi się kod zależny od systemu (prawdopodobnie hooki w Etapie 2).

### D6. Dokumentacja decyzji w `docs/stack.md`

Krótki plik (uzasadnienie w 2–3 akapitach plus tabela „co / dlaczego / alternatywa”), bo plan wymaga „krótko uzasadnić wybór” w repozytorium, a `design.md` po archiwizacji nie jest naturalnym miejscem dla czytelnika README.

## Risks / Trade-offs

- [Natywne uruchamianie `.ts` ogranicza składnię TypeScript (brak `enum`, parametrów-właściwości, przestrzeni nazw)] → `erasableSyntaxOnly` w `tsconfig.json` zgłosi to już przy `check:types`; zasada opisana w `docs/stack.md`.
- [Node 24 może nie być dostępne u osoby pilotującej Etap 8] → `.nvmrc` i `engines` w `package.json`; nvm lub fnm rozwiązują to w minutę. Jeśli okaże się problemem, obniżenie do 22.18 nie wymaga zmian w kodzie.
- [Własny skrypt do linków może nie pokryć wszystkich składni Markdown (linki referencyjne, HTML)] → zakres celowo ograniczony do `[tekst](ścieżka)`; test obejmuje przypadki z kotwicą i katalogiem. Jeśli dokumentacja zacznie używać innych form, rozszerzymy skrypt.
- [`openspec validate --all` może zacząć zgłaszać ostrzeżenia przy przyszłych wersjach CLI] → wersja CLI przypięta w `package-lock.json`; aktualizacja to świadoma zmiana.
- [Sekwencyjne `check` zatrzymuje się na pierwszym błędzie, więc deweloper nie widzi od razu wszystkich problemów] → każdy krok ma własny skrypt; CI pokazuje nazwę kroku, który zawiódł. Prostota ważniejsza niż pełny raport.
- [README wymaga Node 24, ale Claude Code uruchamiający hooki może użyć innego `node` z PATH] → do rozstrzygnięcia eksperymentem w Etapie 2; tutaj tylko odnotowane.

## Migration Plan

Nie dotyczy. Nie ma istniejącego kodu ani użytkowników. Wycofanie zmiany to usunięcie dodanych plików.

## Open Questions

- Czy `demo/` ma być osobnym pakietem npm, żeby wiernie udawać cudze repozytorium? Decyzja w zmianie dla Etapu 7; nie wpływa na tę zmianę.
