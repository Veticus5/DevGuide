# Spec Delta

## Purpose

Zatrzymanie ściśle określonej operacji agenta, zanim zostanie wykonana, w sposób egzekwowany przez integrację z Claude Code, a nie przez instrukcję w prompcie. Jest podstawą punktu kontroli z Etapu 6 i dowodem, że blokada nie jest symulowana.

## ADDED Requirements

### Requirement: Określona operacja jest zatrzymana przed wykonaniem
Integracja SHALL uniemożliwić wykonanie polecenia zawierającego umówiony znacznik blokady: polecenie nie uruchamia się, agent otrzymuje powód odmowy, a odmowa jest zapisana w dzienniku z treścią polecenia.

#### Scenario: Agent próbuje uruchomić blokowane polecenie
- **WHEN** agent wywołuje polecenie zawierające znacznik blokady, które w razie wykonania zostawiłoby ślad na dysku
- **THEN** ślad na dysku nie powstaje, agent otrzymuje komunikat z powodem odmowy, a dziennik zawiera wpis o odmowie z treścią polecenia i czasem

#### Scenario: Agent ponawia próbę
- **WHEN** agent po odmowie ponownie wywołuje to samo polecenie
- **THEN** każda próba jest odrzucana i zapisana osobno

### Requirement: Pozostałe operacje nie są zatrzymywane
Integracja SHALL przepuszczać bez zmian każdą operację, która nie zawiera znacznika blokady, tak aby zakres zatrzymania był dokładnie znany.

#### Scenario: Zwykłe polecenie
- **WHEN** agent uruchamia polecenie bez znacznika blokady
- **THEN** polecenie wykonuje się normalnie, a dziennik zawiera jego treść i wynik

### Requirement: Zatrzymanie potwierdza się skutkiem, nie deklaracją
Status „zatrzymane” SHALL opierać się na braku skutku operacji i na wpisie odmowy pochodzącym z integracji; wypowiedź agenta o tym, co zrobił lub czego nie zrobił, MUST NOT być traktowana jako dowód.

#### Scenario: Agent twierdzi, że wykonał operację
- **WHEN** agent w odpowiedzi pisze, że wykonał blokowane polecenie, a ślad na dysku nie istnieje i dziennik zawiera wpis odmowy
- **THEN** sprawdzenie uznaje operację za zatrzymaną i odnotowuje rozbieżność z wypowiedzią agenta

#### Scenario: Brak wpisu odmowy
- **WHEN** ślad na dysku nie istnieje, ale dziennik nie zawiera wpisu odmowy
- **THEN** sprawdzenie nie uznaje operacji za zatrzymaną przez integrację i zgłasza wynik jako nierozstrzygnięty
