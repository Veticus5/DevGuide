# Spec Delta

## MODIFIED Requirements

### Requirement: Użytkownik rozpoczyna zadanie jednym poleceniem
Użytkownik SHALL móc rozpocząć zadanie wpisując w Claude Code `/devguide` z opisem zadania. Agent MUST potwierdzić w odpowiedzi, że pracuje w trybie DevGuide, przyjąć opis jako treść zadania i prowadzić je według skillu prowadzącego: zapisując ustalenia w dzienniku zadania w trakcie pracy.

#### Scenario: Wywołanie z opisem zadania
- **WHEN** użytkownik wpisuje `/devguide` i opis zadania w tym samym wierszu
- **THEN** odpowiedź agenta zaczyna się od potwierdzenia trybu DevGuide, odnosi się do podanego opisu, a dziennik zadania dostaje ustalenia agenta w trakcie pracy

#### Scenario: Wywołanie bez opisu
- **WHEN** użytkownik wpisuje samo `/devguide`
- **THEN** agent potwierdza tryb DevGuide i prosi o opis zadania zamiast zgadywać
