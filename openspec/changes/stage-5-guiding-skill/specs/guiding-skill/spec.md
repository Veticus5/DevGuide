# Spec Delta

## Purpose

Zachowanie agenta prowadzonego przez skill `/devguide`: w trakcie zadania zapisuje ustalenia w dzienniku DevGuide bez bycia proszonym o konkretne polecenia, zmienia kod narzędziami, które integracja rejestruje, i nie zapisuje niczego, czego dziennik nie mógłby potwierdzić.

## ADDED Requirements

### Requirement: Agent zapisuje ustalenia w trakcie zadania
Agent w trybie DevGuide SHALL zapisywać ustalenia poleceniem DevGuide w trakcie pracy, bez wymieniania mu poleceń w treści zadania: obserwację na początku (co odtworzono lub zobaczono), podejrzenie przed jego sprawdzaniem i jego rozstrzygnięcie po sprawdzeniu, objaśnienie po każdej logicznej poprawce oraz sprawdzenie po każdym poleceniu weryfikującym zachowanie.

#### Scenario: Zadanie podane naturalnie
- **WHEN** użytkownik rozpoczyna przez `/devguide` zadanie „utwórz plik z tekstem hello, zamień hello na greetings, sprawdź, że plik zawiera greetings”, nie wspominając o poleceniach DevGuide
- **THEN** dziennik zadania zawiera co najmniej obserwację, objaśnienie wskazujące zmianę pliku wykonaną narzędziem edycji oraz sprawdzenie ze statusem `passed` i dowodem z wyjścia polecenia

#### Scenario: Wznowiona sesja
- **WHEN** użytkownik wznawia sesję z otwartym zadaniem i prosi o kolejną zmianę
- **THEN** agent nadal zapisuje objaśnienie i sprawdzenie dla tej zmiany, bo kontekst przy starcie sesji przypomina zasady

### Requirement: Zmiany w kodzie wyłącznie narzędziami rejestrowanymi
Agent SHALL zmieniać pliki narzędziami Write i Edit, a nie poleceniami powłoki (`sed`, `printf`, przekierowania), tak aby każda zmiana była zarejestrowana z fragmentem przed i po.

#### Scenario: Zamiana słowa w pliku
- **WHEN** zadanie wymaga zamiany słowa w istniejącym pliku
- **THEN** dziennik zawiera zdarzenie zmiany pliku z fragmentem przed i po, a nie polecenie `sed`

### Requirement: Sprawdzenie ma przedmiot, oczekiwanie i dowód
Agent SHALL zapisywać sprawdzenie tylko dla polecenia, które sprawdza zachowanie produktu lub wynik zmiany, z opisem, oczekiwaniem, dokładnie tym poleceniem, które uruchomił, cytatem z jego wyjścia jako dowodem i ograniczeniami. Agent SHALL NOT zapisywać sprawdzenia dla polecenia, które potwierdza wyłącznie wypisanie tekstu, i SHALL NOT deklarować `passed` bez dowodu z wyjścia.

#### Scenario: Polecenie weryfikujące
- **WHEN** agent uruchamia polecenie czytające zmieniony plik i widzi w wyjściu oczekiwany tekst
- **THEN** zapisuje sprawdzenie z tym poleceniem, cytatem tego tekstu i wynikiem `passed`, a dziennik nadaje mu status `passed`

#### Scenario: Polecenie bez wartości dowodowej
- **WHEN** agent uruchamia `echo done` po zakończeniu pracy
- **THEN** nie zapisuje dla niego sprawdzenia

### Requirement: Decyzja użytkownika jest zapisywana jego słowami
Gdy agent zadaje użytkownikowi pytanie, a użytkownik odpowiada, agent SHALL zapisać decyzję z pytaniem, dosłownym cytatem odpowiedzi i własnym odczytem, zanim zacznie działać zgodnie z nią.

#### Scenario: Użytkownik wybiera wariant
- **WHEN** agent pyta „Zastosować poprawkę A czy B?”, a użytkownik odpowiada „A”
- **THEN** dziennik zawiera decyzję z cytatem „A” oznaczoną jako potwierdzona, zapisaną przed zmianą plików

### Requirement: Uczciwość wobec dziennika
Agent SHALL NOT zapisywać wyników, których nie zaobserwował, ani objaśnień zmian, których nie wykonał, i SHALL zgłaszać w odpowiedzi odmowy i błędy narzędzi zamiast je pomijać.

#### Scenario: Polecenie odrzucone przez blokadę
- **WHEN** integracja odrzuca polecenie agenta
- **THEN** odpowiedź agenta mówi o odmowie, a dziennik nie zawiera sprawdzenia ani objaśnienia opartego na tym poleceniu
