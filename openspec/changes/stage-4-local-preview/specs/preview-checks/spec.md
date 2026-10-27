# Spec Delta

## Purpose

Widok „Wyniki sprawdzeń”: co faktycznie uruchomiono, jaki otrzymano wynik, czego on dotyczy i jakie ma ograniczenia, z wyraźnym oddzieleniem sprawdzeń potwierdzonych wykonaniem od niepotwierdzonych oraz z oznaczeniem wyników, które straciły aktualność po zmianie kodu.

## ADDED Requirements

### Requirement: Każde sprawdzenie pokazuje, co uruchomiono i jaki był wynik
Widok SHALL pokazać dla każdego sprawdzenia: opis prostym językiem, oczekiwanie, status (przeszło, nie przeszło, nierozstrzygnięte, niepotwierdzone), uruchomione polecenie, dowód cytowany z wyjścia oraz ograniczenia podane przez agenta. Pełne wyjście polecenia SHALL być dostępne na żądanie i oznaczone jako wynik narzędzia.

#### Scenario: Sprawdzenie, które przeszło
- **WHEN** zadanie zawiera sprawdzenie ze statusem `passed` wskazujące zarejestrowane wykonanie
- **THEN** widok pokazuje opis, status „przeszło”, polecenie, cytowany dowód i na żądanie pełne wyjście tego wykonania z oznaczeniem „wynik narzędzia”

#### Scenario: Sprawdzenie z ograniczeniami
- **WHEN** agent zapisał sprawdzenie z ograniczeniami, na przykład „dane syntetyczne, bez filtrów”
- **THEN** karta sprawdzenia pokazuje te ograniczenia obok wyniku, oznaczone jako podane przez AI

### Requirement: Sprawdzenia niepotwierdzone są oddzielone i mają powód
Sprawdzenie ze statusem `unverified` SHALL być pokazane oddzielnie od sprawdzeń potwierdzonych, z powodem prostym językiem i z deklarowanym przez agenta wynikiem oznaczonym jako niepotwierdzona deklaracja.

#### Scenario: Deklaracja bez wykonania
- **WHEN** agent zapisał sprawdzenie z wynikiem `passed` bez zarejestrowanego wykonania polecenia
- **THEN** widok pokazuje je w sekcji niepotwierdzonych z powodem „brak zarejestrowanego wykonania polecenia” i z informacją, że „przeszło” jest tylko deklaracją AI

### Requirement: Wynik nieaktualny po zmianie kodu jest wyraźnie oznaczony
Sprawdzenie, po którym w zadaniu pojawiły się zdarzenia z inną wersją kodu, SHALL być oznaczone jako wykonane na wcześniejszej wersji kodu, z listą plików zmienionych od tego czasu, i MUST NOT być pokazane jako potwierdzenie bieżącego rozwiązania.

#### Scenario: Zmiana pliku po sprawdzeniu
- **WHEN** sprawdzenie przeszło, a potem agent zmienił plik
- **THEN** widok pokazuje „przeszło na wcześniejszej wersji kodu” i nazwę zmienionego pliku, a nagłówek widoku nie liczy go wśród sprawdzeń potwierdzających bieżący kod

#### Scenario: Brak zmian po sprawdzeniu
- **WHEN** po sprawdzeniu nie ma zdarzeń z inną wersją kodu
- **THEN** widok pokazuje sprawdzenie jako aktualne

### Requirement: Widok zawiera tylko sprawdzenia
Widok SHALL zawierać wyłącznie sprawdzenia, czyli zapisy z przedmiotem, oczekiwanym rezultatem i zaobserwowanym wynikiem. Zwykłe polecenia bez sprawdzenia SHALL NOT pojawiać się w tym widoku; są dostępne w źródłach kroków w „Przebiegu”. Zakładka SHALL być pokazywana tylko wtedy, gdy zadanie ma co najmniej jedno sprawdzenie.

#### Scenario: Polecenie bez sprawdzenia
- **WHEN** agent uruchomił `echo done` i nie zapisał sprawdzenia
- **THEN** widok sprawdzeń nie wymienia tego polecenia, a gdy zadanie nie ma żadnego sprawdzenia, zakładka „Wyniki sprawdzeń” nie jest pokazywana

### Requirement: Potwierdzenie jest widoczne przy kroku, którego dotyczy
Widok kroku zmiany w kodzie SHALL wymieniać sprawdzenia zapisane po tej zmianie wraz z ich statusem i odsyłaczem do kroku sprawdzenia, tak aby użytkownik widział potwierdzenie obok zmiany, a nie tylko w osobnej zakładce.

#### Scenario: Sprawdzenie po zmianie
- **WHEN** agent zmienił plik z objaśnieniem, a potem zapisał sprawdzenie, które przeszło
- **THEN** widok kroku zmiany wymienia to sprawdzenie ze statusem „przeszło” i odsyłaczem do jego kroku

#### Scenario: Zmiana bez późniejszych sprawdzeń
- **WHEN** po zmianie nie zapisano żadnego sprawdzenia
- **THEN** widok kroku zmiany mówi, że żadne sprawdzenie nie zostało zapisane po tej zmianie

### Requirement: Stan sprawdzeń prostym językiem w nagłówku
Nagłówek widoku SHALL podsumować: ile sprawdzeń potwierdza bieżący kod, ile przeszło na wcześniejszej wersji, ile nie przeszło i ile jest niepotwierdzonych, bez identyfikatorów technicznych.

#### Scenario: Mieszany stan
- **WHEN** zadanie ma jedno sprawdzenie aktualne, jedno na wcześniejszej wersji i jedno niepotwierdzone
- **THEN** nagłówek podaje te trzy liczby z opisem słownym
