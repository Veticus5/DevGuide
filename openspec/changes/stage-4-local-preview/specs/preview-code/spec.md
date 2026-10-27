# Spec Delta

## Purpose

Widok „Kod AI”: logiczne poprawki wykonane przez agenta, każda na osobnej karcie z lokalizacją w kodzie, fragmentem przed i po zmianie pochodzącym z narzędzia, objaśnieniem celu i mechanizmu, przykładem działania oraz założeniami, z pełnym diffem dostępnym na żądanie.

## ADDED Requirements

### Requirement: Każda logiczna poprawka ma osobną kartę
Widok SHALL pokazać jedną kartę na każde objaśnienie poprawki zapisane przez agenta. Karta MUST zawierać tytuł, lokalizację w kodzie (pliki i, gdy zapis narzędzia je ma, numery wierszy), fragment „przed poprawką” i „po poprawce” z zapisu narzędzia, cel i mechanizm, przykład wejścia, wyniku lub zmiany danych oraz założenia i ograniczenia. Treści od agenta MUST być odróżnialne od fragmentów z narzędzia.

#### Scenario: Poprawka w jednym pliku
- **WHEN** agent zmienił fragment pliku narzędziem edycji i zapisał objaśnienie tej zmiany z tytułem, celem, mechanizmem, przykładem i założeniami
- **THEN** widok pokazuje kartę z tytułem, ścieżką pliku i wierszem zmiany, fragmentem przed i po z oznaczeniem „wynik narzędzia”, objaśnieniem z oznaczeniem „AI” i przykładem z oznaczeniem „ilustracja od AI”

#### Scenario: Poprawka w kilku plikach
- **WHEN** jedno objaśnienie obejmuje zmiany w dwóch plikach
- **THEN** karta pokazuje obie lokalizacje i oba fragmenty przed i po, w kolejności zapisu

#### Scenario: Objaśnienie bez zarejestrowanej zmiany
- **WHEN** agent zapisał objaśnienie, z którym nie wiąże się żadna zarejestrowana zmiana pliku
- **THEN** karta pokazuje objaśnienie z wyraźną informacją, że nie ma zarejestrowanej zmiany pliku, i nie pokazuje żadnego fragmentu jako „po poprawce”

### Requirement: Zmiany bez objaśnienia nie znikają
Zmiany plików zarejestrowane przez narzędzie, których nie obejmuje żadne objaśnienie, SHALL być pokazane osobno jako obserwacje narzędzia z fragmentem przed i po, oznaczone jako „bez objaśnienia od AI”.

#### Scenario: Plik zmieniony bez objaśnienia
- **WHEN** agent zmienił plik i nie zapisał żadnego objaśnienia
- **THEN** widok pokazuje tę zmianę w sekcji zmian bez objaśnienia, z fragmentem przed i po i bez żadnego tekstu interpretacji

### Requirement: Pełny diff dostępny na żądanie
Widok SHALL udostępnić na żądanie pełny diff zadania: wszystkie zarejestrowane łatki zmian plików w kolejności zapisu, pogrupowane według pliku, w formacie ujednoliconym (unified). Diff MUST pochodzić wyłącznie z zapisu narzędzia.

#### Scenario: Diff po dwóch zmianach jednego pliku
- **WHEN** agent dwukrotnie zmienił ten sam plik
- **THEN** pełny diff zawiera obie łatki pod jednym nagłówkiem pliku, w kolejności zapisu

#### Scenario: Nowy plik
- **WHEN** agent utworzył nowy plik
- **THEN** pełny diff pokazuje go jako plik utworzony z całą treścią jako dodaną

### Requirement: Wersja kodu w głównym widoku to „przed” i „po”
W głównym widoku karta SHALL używać określeń „przed poprawką” i „po poprawce”. Commit i odcisk drzewa roboczego SHALL być dostępne w szczegółach karty, nie w jej głównej treści.

#### Scenario: Szczegóły wersji
- **WHEN** użytkownik rozwija szczegóły karty
- **THEN** widzi commit i odcisk drzewa roboczego z chwili zmiany, których nie ma w głównej treści karty

### Requirement: Przygotowana zmiana jest pokazana jako propozycja
Zmiana przygotowana przez agenta, a niezastosowana, SHALL być pokazana w widoku jako propozycja z tekstem i łatką, oznaczona jako niezastosowana i odróżniona od kart poprawek, które mają zarejestrowane zmiany plików.

#### Scenario: Propozycja bez zastosowania
- **WHEN** agent zapisał przygotowaną zmianę z łatką, a nie zmienił żadnego pliku
- **THEN** widok pokazuje propozycję z łatką i oznaczeniem „niezastosowana”, a sekcja kart poprawek jest pusta
