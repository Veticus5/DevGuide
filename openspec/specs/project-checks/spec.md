# project-checks Specification

## Purpose

Daje deweloperowi i CI jeden sposób, by stwierdzić, czy repozytorium DevGuide jest w spójnym stanie, i dowiedzieć się, co dokładnie jest zepsute.

## Requirements

### Requirement: Jedno polecenie sprawdza cały projekt
Projekt SHALL udostępniać jedno polecenie, które uruchamia wszystkie podstawowe sprawdzenia (typy, testy, linki w dokumentacji, artefakty OpenSpec) i kończy się kodem wyjścia 0 tylko wtedy, gdy każde z nich przeszło.

#### Scenario: Wszystko w porządku
- **WHEN** deweloper uruchamia polecenie sprawdzające w czystym, poprawnym repozytorium
- **THEN** polecenie kończy się kodem 0, a wynik pokazuje, że każde sprawdzenie przeszło

#### Scenario: Jedno sprawdzenie nie przechodzi
- **WHEN** co najmniej jedno sprawdzenie wykrywa problem
- **THEN** polecenie kończy się kodem różnym od 0, a wynik wskazuje, które sprawdzenie i który plik lub miejsce są przyczyną

### Requirement: Każde sprawdzenie można uruchomić osobno
Projekt SHALL pozwalać uruchomić każde sprawdzenie niezależnie od pozostałych, tak aby deweloper mógł szybko powtórzyć tylko to, nad czym pracuje.

#### Scenario: Powtórzenie tylko testów
- **WHEN** deweloper uruchamia samo sprawdzenie testów
- **THEN** uruchamiane są wyłącznie testy, a wynik nie zależy od stanu typów, linków ani artefaktów OpenSpec

### Requirement: Sprawdzenie linków w dokumentacji
Projekt SHALL wykrywać w plikach Markdown repozytorium linki względne, które wskazują na nieistniejący plik lub katalog, i zgłaszać je z nazwą pliku źródłowego i celem linku.

#### Scenario: Link do brakującego pliku
- **WHEN** plik Markdown zawiera link względny do pliku, którego nie ma w repozytorium
- **THEN** sprawdzenie kończy się niepowodzeniem i podaje plik, w którym jest link, oraz ścieżkę, której nie znaleziono

#### Scenario: Linki zewnętrzne i kotwice
- **WHEN** plik Markdown zawiera link z protokołem (np. `https://`) lub link do kotwicy w tym samym pliku (`#sekcja`)
- **THEN** sprawdzenie nie traktuje go jako błędu i nie wykonuje żądań sieciowych

### Requirement: CI uruchamia to samo sprawdzenie
Repozytorium SHALL uruchamiać to samo polecenie sprawdzające automatycznie przy każdym push i pull request do gałęzi głównej, a wynik tego uruchomienia SHALL być widoczny przy pull requeście.

#### Scenario: Pull request z błędem
- **WHEN** pull request wprowadza zmianę, przy której polecenie sprawdzające kończy się niepowodzeniem
- **THEN** zadanie CI tego pull requestu kończy się niepowodzeniem i wskazuje, które sprawdzenie nie przeszło

#### Scenario: Zgodność lokalnie i w CI
- **WHEN** polecenie sprawdzające przechodzi lokalnie na tej samej wersji kodu i wspieranej wersji Node.js
- **THEN** zadanie CI dla tej wersji również przechodzi

### Requirement: Sprawdzenia nie wymagają sekretów ani sieci
Polecenie sprawdzające SHALL działać bez żadnych sekretów, zmiennych środowiskowych specyficznych dla osoby ani dostępu do zewnętrznych usług poza pobraniem zależności.

#### Scenario: Świeży klon
- **WHEN** deweloper klonuje repozytorium na maszynę ze wspieraną wersją Node.js i instaluje zależności
- **THEN** polecenie sprawdzające działa bez dodatkowej konfiguracji
