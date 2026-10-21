# Spec Delta

## Purpose

Zapis przebiegu jednego zadania DevGuide jako ciągu zdarzeń, które pozwalają odtworzyć, co zaobserwowano, co założono, co zmieniono, co zdecydowano i co sprawdzono, z pochodzeniem każdej informacji, czasem, powiązanymi plikami i wersją kodu. Obserwacje narzędzi i ustalenia agenta są odróżnialne na poziomie zapisu, a status sprawdzenia nie może powstać z samej opinii AI.

## ADDED Requirements

### Requirement: Zadanie zaczyna się od polecenia użytkownika
Dziennik zadania SHALL powstać w chwili, gdy użytkownik rozpoczyna zadanie przez `/devguide`, z identyfikatorem zadania, opisem podanym przez użytkownika, czasem rozpoczęcia i identyfikatorem sesji. Od tej chwili kolejne zdarzenia w tej sesji SHALL trafiać do tego zadania, aż użytkownik rozpocznie nowe zadanie.

#### Scenario: Rozpoczęcie zadania
- **WHEN** użytkownik wpisuje `/devguide Eksport pobiera tylko pierwszą stronę`
- **THEN** powstaje nowe zadanie z tym opisem, a jego pierwszym zdarzeniem jest rozpoczęcie zadania pochodzenia „użytkownik”

#### Scenario: Kolejne zadanie
- **WHEN** użytkownik rozpoczyna przez `/devguide` drugie zadanie, gdy pierwsze ma już zdarzenia
- **THEN** powstaje osobne zadanie, zdarzenia pierwszego pozostają nienaruszone, a nowe zdarzenia trafiają do drugiego

#### Scenario: Działania bez zadania
- **WHEN** agent używa narzędzi w sesji, w której nie rozpoczęto zadania
- **THEN** nie powstaje żadne zdarzenie zadania, a surowy dziennik hooków działa jak dotąd

### Requirement: Każde zdarzenie ma pochodzenie, czas, pliki i wersję kodu
Każde zdarzenie SHALL zawierać identyfikator, czas, pochodzenie (`user` — tekst użytkownika, `tool` — wynik narzędzia, `agent` — ustalenie agenta, `devguide` — zapis własny DevGuide), listę powiązanych plików oraz wersję kodu złożoną z commita i odcisku drzewa roboczego, albo wyraźne oznaczenie, że wersja jest nieznana.

#### Scenario: Zmiana w drzewie roboczym bez commita
- **WHEN** agent zmienia plik, a następnie uruchamia polecenie, bez zatwierdzania zmian w Git
- **THEN** oba zdarzenia mają ten sam commit, ale różne odciski drzewa roboczego

#### Scenario: Katalog bez repozytorium Git
- **WHEN** zadanie odbywa się w katalogu, który nie jest repozytorium Git
- **THEN** zdarzenia mają wersję kodu oznaczoną jako nieznana, a zapis nie kończy się błędem

### Requirement: Zmiany plików i polecenia pochodzą z narzędzi
Dziennik zadania SHALL zapisywać zmianę pliku (ścieżka, czy utworzony, fragment przed i po lub łatka) i uruchomione polecenie (treść, wyjście standardowe, wyjście błędów, przerwanie) na podstawie wyniku zwróconego przez narzędzie, z pochodzeniem `tool`. Brak kodu wyjścia MUST być zapisany jako nieznany, nie jako 0.

#### Scenario: Agent edytuje plik
- **WHEN** agent zmienia fragment pliku narzędziem edycji
- **THEN** w zadaniu powstaje zdarzenie zmiany pliku z jego ścieżką, fragmentem przed i po zmianie oraz pochodzeniem `tool`

#### Scenario: Agent uruchamia polecenie
- **WHEN** agent uruchamia polecenie, które wypisuje tekst
- **THEN** w zadaniu powstaje zdarzenie uruchomionego polecenia z jego treścią, wypisanym tekstem i kodem wyjścia oznaczonym jako nieznany

#### Scenario: Narzędzie zgłasza błąd
- **WHEN** narzędzie kończy się błędem zgłoszonym przez integrację
- **THEN** w zadaniu powstaje zdarzenie nieudanego narzędzia z nazwą narzędzia, danymi wejściowymi i komunikatem błędu

#### Scenario: Polecenie zapisu ustalenia nie jest poleceniem zadania
- **WHEN** agent uruchamia polecenie DevGuide, którym zapisuje ustalenie
- **THEN** w zadaniu powstaje tylko zdarzenie ustalenia, a nie dodatkowe zdarzenie uruchomionego polecenia

### Requirement: Wypowiedzi użytkownika i agenta są zapisane dosłownie
Dziennik zadania SHALL zapisywać każdą kolejną wypowiedź użytkownika w zadaniu z pochodzeniem `user` oraz komunikat agenta kończący turę z pochodzeniem `agent`, w brzmieniu przekazanym przez integrację.

#### Scenario: Użytkownik odpowiada agentowi
- **WHEN** użytkownik w trakcie zadania wpisuje odpowiedź
- **THEN** w zadaniu powstaje zdarzenie wypowiedzi użytkownika z jej pełną treścią

#### Scenario: Agent kończy turę
- **WHEN** agent kończy turę i oddaje głos
- **THEN** w zadaniu powstaje zdarzenie komunikatu agenta z jego ostatnią wypowiedzią, odróżnialne od zdarzeń narzędzi

### Requirement: Agent zapisuje ustalenia jednym poleceniem
Agent SHALL móc zapisać poleceniem DevGuide zdarzenie o pochodzeniu `agent`: obserwację, hipotezę, rozstrzygnięcie hipotezy, propozycję, przygotowaną zmianę, decyzję użytkownika lub sprawdzenie, z tekstem prostym językiem, listą plików i opcjonalnymi materiałami. Polecenie MUST wypisać identyfikator zapisanego zdarzenia i zakończyć się błędem z czytelnym komunikatem, gdy brak otwartego zadania lub wymaganych pól.

#### Scenario: Zapis obserwacji z materiałem
- **WHEN** agent zapisuje obserwację z opisem i przykładem danych
- **THEN** w zadaniu powstaje zdarzenie obserwacji z pochodzeniem `agent`, a materiał jest oznaczony jako ilustracja podana przez agenta

#### Scenario: Brak otwartego zadania
- **WHEN** agent próbuje zapisać ustalenie, gdy nie rozpoczęto zadania
- **THEN** polecenie kończy się błędem z komunikatem, że nie ma otwartego zadania, i nic nie zapisuje

#### Scenario: Brak wymaganego pola
- **WHEN** agent zapisuje hipotezę bez treści
- **THEN** polecenie kończy się błędem wskazującym brakujące pole i nic nie zapisuje

### Requirement: Rozstrzygnięcie hipotezy zachowuje historię
Rozstrzygnięcie hipotezy (potwierdzona lub odrzucona) SHALL być osobnym zdarzeniem wskazującym identyfikator hipotezy i uzasadnienie; wcześniejsze zdarzenia MUST NOT być zmieniane ani usuwane.

#### Scenario: Odrzucenie hipotezy
- **WHEN** agent zapisuje odrzucenie wcześniej zapisanej hipotezy z powodem
- **THEN** zadanie zawiera zarówno zdarzenie hipotezy, jak i zdarzenie jej odrzucenia wskazujące tę hipotezę

#### Scenario: Nieistniejąca hipoteza
- **WHEN** agent zapisuje rozstrzygnięcie z identyfikatorem, którego nie ma w zadaniu
- **THEN** polecenie kończy się błędem i nic nie zapisuje

### Requirement: Status sprawdzenia wymaga zarejestrowanego wykonania i dowodu
Sprawdzenie SHALL zawierać opis prostym językiem, oczekiwanie, wskazanie polecenia, deklarowany wynik (`passed`, `failed`, `inconclusive`) i cytowany dowód. Status `passed` MUST powstać tylko, gdy w zadaniu istnieje zdarzenie uruchomienia tego polecenia, a dowód występuje w jego zapisanym wyjściu; w innym wypadku zapis dostaje status `unverified` z podanym powodem.

#### Scenario: Sprawdzenie z wykonaniem i dowodem
- **WHEN** agent uruchomił polecenie, którego wyjście zawiera tekst „250 records written”, i zapisuje sprawdzenie wskazujące to polecenie z tym tekstem jako dowodem i wynikiem `passed`
- **THEN** sprawdzenie ma status `passed` i wskazuje identyfikator zdarzenia uruchomienia

#### Scenario: Sprawdzenie bez wykonania
- **WHEN** agent zapisuje sprawdzenie z wynikiem `passed` wskazujące polecenie, którego uruchomienia nie ma w zadaniu
- **THEN** sprawdzenie jest zapisane ze statusem `unverified` i powodem „brak zarejestrowanego wykonania”

#### Scenario: Dowód nie występuje w wyjściu
- **WHEN** agent zapisuje sprawdzenie wskazujące uruchomione polecenie, ale cytowany dowód nie występuje w jego zapisanym wyjściu
- **THEN** sprawdzenie jest zapisane ze statusem `unverified` i powodem „dowodu nie ma w wyjściu polecenia”

#### Scenario: Samo zakończenie polecenia nie jest dowodem
- **WHEN** agent zapisuje sprawdzenie bez cytowanego dowodu, powołując się tylko na to, że polecenie się wykonało
- **THEN** sprawdzenie ma status `unverified`, a nie `passed`

### Requirement: Decyzja użytkownika jest wiązana z jego wypowiedzią
Decyzja SHALL zawierać pytanie, cytat odpowiedzi użytkownika i jej odczyt przez agenta. Decyzja MUST być oznaczona jako potwierdzona tylko wtedy, gdy cytat występuje w zapisanej wypowiedzi użytkownika w tym zadaniu; w przeciwnym razie jest zapisana jako niepotwierdzona.

#### Scenario: Cytat zgodny z wypowiedzią
- **WHEN** użytkownik napisał „Tak, zastosuj poprawkę A”, a agent zapisuje decyzję z tym cytatem
- **THEN** decyzja jest oznaczona jako potwierdzona i wskazuje zdarzenie wypowiedzi użytkownika

#### Scenario: Cytat bez pokrycia
- **WHEN** agent zapisuje decyzję z cytatem, którego nie ma w żadnej wypowiedzi użytkownika w zadaniu
- **THEN** decyzja jest zapisana jako niepotwierdzona i tak pokazywana przy odtwarzaniu

### Requirement: Materiały rozróżniają ilustrację od wyniku
Każdy materiał dołączony do zdarzenia SHALL mieć oznaczenie, czy jest ilustracją podaną przez agenta, czy rzeczywistym wynikiem pochodzącym z narzędzia. Materiał z polecenia zapisu ustaleń MUST być zawsze ilustracją.

#### Scenario: Przykład od agenta
- **WHEN** agent dołącza do propozycji przykładowe wejście i wynik
- **THEN** oba materiały są oznaczone jako ilustracja

#### Scenario: Wynik z narzędzia
- **WHEN** w zadaniu zapisano uruchomione polecenie z wypisanym tekstem
- **THEN** ten tekst jest dostępny jako rzeczywisty wynik, nie ilustracja

### Requirement: Dziennik zadania jest dopisywany i leży poza Git
Zdarzenia zadania SHALL być dopisywane na końcu pliku zadania w katalogu roboczym ignorowanym przez Git; zapis MUST NOT nadpisywać ani usuwać wcześniejszych zdarzeń, a błąd zapisu z hooka MUST być zgłoszony w diagnostyce bez przerywania pracy agenta.

#### Scenario: Stan repozytorium po zadaniu
- **WHEN** po zadaniu użytkownik sprawdza stan Git
- **THEN** pliki zadania nie są pokazywane jako nowe ani zmienione

#### Scenario: Niezapisywalny katalog
- **WHEN** katalog zadania jest niedostępny do zapisu podczas użycia narzędzia
- **THEN** narzędzie działa normalnie, a diagnostyka zawiera informację o nieudanym zapisie
