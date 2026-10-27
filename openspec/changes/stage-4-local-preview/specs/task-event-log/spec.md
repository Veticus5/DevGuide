# Spec Delta

## ADDED Requirements

### Requirement: Agent objaśnia poprawkę osobnym zdarzeniem
Agent SHALL móc zapisać poleceniem DevGuide objaśnienie poprawki (pochodzenie `agent`) z tytułem, celem, mechanizmem, założeniami i ograniczeniami, listą plików oraz opcjonalnym przykładem jako materiałem. Zapis MUST powiązać objaśnienie z zarejestrowanymi zdarzeniami zmiany pliku: ze wskazanymi identyfikatorami albo, gdy ich nie podano, z wcześniejszymi zmianami wymienionych plików, których nie obejmuje żadne wcześniejsze objaśnienie.

#### Scenario: Objaśnienie po zmianie pliku
- **WHEN** agent zmienił plik `src/export.ts` narzędziem edycji i zapisuje objaśnienie z tym plikiem bez wskazywania identyfikatorów
- **THEN** zdarzenie objaśnienia wskazuje identyfikator tej zmiany pliku

#### Scenario: Dwa objaśnienia tego samego pliku
- **WHEN** agent zmienił plik, objaśnił zmianę, zmienił plik ponownie i objaśnia drugą zmianę bez identyfikatorów
- **THEN** drugie objaśnienie wskazuje tylko drugą zmianę pliku

#### Scenario: Wskazane identyfikatory
- **WHEN** agent zapisuje objaśnienie ze wskazanymi identyfikatorami dwóch zmian plików
- **THEN** objaśnienie wskazuje dokładnie te dwie zmiany, a nieistniejący identyfikator kończy polecenie błędem bez zapisu

#### Scenario: Brak pasującej zmiany
- **WHEN** agent zapisuje objaśnienie pliku, którego żadna zarejestrowana zmiana nie dotyczy
- **THEN** objaśnienie jest zapisane bez wskazanych zmian i przy odczycie pokazywane jako objaśnienie bez zarejestrowanej zmiany pliku

#### Scenario: Brak wymaganego pola
- **WHEN** agent zapisuje objaśnienie bez tytułu lub bez celu
- **THEN** polecenie kończy się błędem wskazującym brakujące pole i nic nie zapisuje

### Requirement: Koniec sesji jest zapisany w zadaniu
Gdy sesja Claude Code kończy się przy otwartym zadaniu, dziennik zadania SHALL zawierać zdarzenie zakończenia sesji z pochodzeniem `devguide` i powodem przekazanym przez integrację, tak aby odczyt mógł odróżnić zadanie, nad którym agent pracuje, od zadania po zamkniętej sesji.

#### Scenario: Zakończenie sesji
- **WHEN** sesja z otwartym zadaniem kończy się
- **THEN** ostatnim zdarzeniem zadania jest zakończenie sesji z powodem

#### Scenario: Zakończenie sesji bez zadania
- **WHEN** sesja bez otwartego zadania kończy się
- **THEN** nic nie jest zapisywane w żadnym zadaniu

### Requirement: Sprawdzenie może mieć ograniczenia
Sprawdzenie SHALL przyjmować opcjonalny tekst ograniczeń prostym językiem (na przykład zakres danych, pominięte przypadki). Ograniczenia MUST być zapisane jako treść od agenta i MUST NOT wpływać na status sprawdzenia.

#### Scenario: Sprawdzenie z ograniczeniami
- **WHEN** agent zapisuje sprawdzenie z wykonaniem, dowodem i tekstem ograniczeń
- **THEN** zdarzenie ma status wynikający z wykonania i dowodu oraz zapisany tekst ograniczeń

#### Scenario: Sprawdzenie bez ograniczeń
- **WHEN** agent zapisuje sprawdzenie bez tekstu ograniczeń
- **THEN** zdarzenie jest zapisane z pustym oznaczeniem ograniczeń i czyta się jak dotąd
