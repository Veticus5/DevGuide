# task-entry-point Specification

## Purpose

Jedno wejście, którym użytkownik rozpoczyna zadanie DevGuide w Claude Code: polecenie `/devguide` z opisem zadania. Na tym etapie potwierdza aktywację i zostawia ślad w dzienniku; prowadzenie zadania dodaje Etap 5.

## Requirements

### Requirement: Użytkownik rozpoczyna zadanie jednym poleceniem
Użytkownik SHALL móc rozpocząć zadanie wpisując w Claude Code `/devguide` z opisem zadania. Agent MUST potwierdzić w odpowiedzi, że pracuje w trybie DevGuide, i przyjąć opis jako treść zadania.

#### Scenario: Wywołanie z opisem zadania
- **WHEN** użytkownik wpisuje `/devguide` i opis zadania w tym samym wierszu
- **THEN** odpowiedź agenta zaczyna się od potwierdzenia trybu DevGuide i odnosi się do podanego opisu

#### Scenario: Wywołanie bez opisu
- **WHEN** użytkownik wpisuje samo `/devguide`
- **THEN** agent potwierdza tryb DevGuide i prosi o opis zadania zamiast zgadywać

### Requirement: Rozpoczęcie zadania jest zapisane w dzienniku
Integracja SHALL zapisać w dzienniku wpis o rozpoczęciu zadania z opisem podanym przez użytkownika i identyfikatorem sesji. Wpis pochodzi z integracji, nie z wypowiedzi agenta.

#### Scenario: Ślad rozpoczęcia
- **WHEN** użytkownik rozpoczyna zadanie przez `/devguide`
- **THEN** dziennik zawiera wpis o rozpoczęciu zadania z opisem i sesją, zanim agent wykona pierwsze narzędzie

### Requirement: Tryb DevGuide uruchamia tylko użytkownik
Agent SHALL NOT uruchamiać trybu DevGuide z własnej inicjatywy; tryb jest dostępny wyłącznie przez polecenie wpisane przez użytkownika.

#### Scenario: Zwykłe polecenie użytkownika
- **WHEN** użytkownik wydaje zwykłe polecenie, nawet wspominające o DevGuide
- **THEN** dziennik nie zawiera wpisu o rozpoczęciu zadania, a agent nie deklaruje trybu DevGuide
