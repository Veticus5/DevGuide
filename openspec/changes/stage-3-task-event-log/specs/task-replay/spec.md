# Spec Delta

## Purpose

Odczyt dziennika zadania w postaci, którą rozumie człowiek i z której agent może wznowić pracę: przebieg prostym językiem, bieżący stan hipotez i sprawdzeń, oznaczenie wyników zdezaktualizowanych przez późniejsze zmiany kodu oraz kontekst zadania przekazywany agentowi na starcie sesji.

## ADDED Requirements

### Requirement: Przebieg zadania czyta się prostym językiem
Użytkownik SHALL móc jednym poleceniem wypisać przebieg bieżącego zadania w kolejności czasu: każde zdarzenie jednym zdaniem prostym językiem z oznaczeniem pochodzenia, a identyfikatory, pełne wyjścia poleceń i łatki tylko w szczegółach dostępnych na żądanie.

#### Scenario: Przebieg z ustaleniami i narzędziami
- **WHEN** zadanie zawiera obserwację, zmianę pliku, uruchomione polecenie i sprawdzenie
- **THEN** wypis pokazuje te cztery zdarzenia w kolejności czasu, każde z oznaczeniem, czy pochodzi od agenta, z narzędzia czy od użytkownika

#### Scenario: Szczegóły na żądanie
- **WHEN** użytkownik prosi o szczegóły konkretnego zdarzenia
- **THEN** wypis zawiera jego identyfikator, wersję kodu, pliki i pełną treść (np. wyjście polecenia lub fragment przed i po)

#### Scenario: Brak zadania
- **WHEN** użytkownik prosi o przebieg, a nie rozpoczęto żadnego zadania
- **THEN** polecenie informuje, że nie ma zadania, i kończy się bez błędu składniowego

### Requirement: Stan zadania podsumowuje hipotezy i sprawdzenia
Odczyt SHALL udostępniać podsumowanie stanu zadania: opis zadania, hipotezy z ich statusem (otwarta, potwierdzona, odrzucona), sprawdzenia z ich statusem i niepotwierdzone decyzje, tak aby było widać, co ustalono i co nadal jest przypuszczeniem.

#### Scenario: Odrzucona hipoteza pozostaje widoczna
- **WHEN** zadanie zawiera hipotezę i jej odrzucenie
- **THEN** podsumowanie pokazuje tę hipotezę jako odrzuconą wraz z powodem, a nie pomija jej

#### Scenario: Sprawdzenie niepotwierdzone
- **WHEN** zadanie zawiera sprawdzenie ze statusem `unverified`
- **THEN** podsumowanie pokazuje je jako niepotwierdzone z powodem, oddzielnie od sprawdzeń ze statusem `passed`

### Requirement: Wynik sprawdzenia traci aktualność po zmianie kodu
Odczyt SHALL oznaczać sprawdzenie jako nieaktualne, gdy wersja kodu późniejszego zdarzenia w zadaniu różni się od wersji kodu zapisanej przy wykonaniu polecenia tego sprawdzenia.

#### Scenario: Zmiana pliku po sprawdzeniu
- **WHEN** po sprawdzeniu ze statusem `passed` agent zmienia plik
- **THEN** sprawdzenie jest pokazywane jako „przeszło na wcześniejszej wersji kodu”, nie jako bezwarunkowo potwierdzone

#### Scenario: Brak zmian po sprawdzeniu
- **WHEN** po sprawdzeniu nie ma zdarzeń z inną wersją kodu
- **THEN** sprawdzenie jest pokazywane jako aktualne

### Requirement: Odczyt dostępny jako dane
Odczyt SHALL udostępniać te same informacje w postaci JSON (zdarzenia i podsumowanie stanu), tak aby podgląd mógł je wyświetlić bez ponownej interpretacji pliku zadania.

#### Scenario: Wypis JSON
- **WHEN** użytkownik prosi o przebieg w formacie JSON
- **THEN** wypis jest poprawnym JSON zawierającym listę zdarzeń i podsumowanie stanu zgodne z wypisem tekstowym

### Requirement: Agent dostaje kontekst zadania przy starcie sesji
Gdy sesja Claude Code startuje lub jest wznawiana przy otwartym zadaniu, integracja SHALL przekazać agentowi krótki kontekst: identyfikator i opis zadania, liczbę zdarzeń, stan hipotez i sprawdzeń oraz polecenie, którym odczyta pełny przebieg. Zdarzenie wznowienia SHALL być zapisane w zadaniu.

#### Scenario: Wznowienie z otwartym zadaniem
- **WHEN** użytkownik wznawia sesję, w której rozpoczęto zadanie
- **THEN** zadanie zawiera zdarzenie wznowienia, a agent potrafi podać identyfikator zadania, którego nie widział w rozmowie

#### Scenario: Start bez zadania
- **WHEN** sesja startuje, a nie ma otwartego zadania
- **THEN** agent nie dostaje żadnego kontekstu DevGuide i nic nie jest zapisywane
