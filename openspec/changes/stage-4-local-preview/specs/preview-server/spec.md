# Spec Delta

## Purpose

Lokalny proces, który udostępnia bieżące zadanie DevGuide podglądowi w przeglądarce i powiadamia otwartą stronę o każdym nowym zdarzeniu oraz o rozpoczęciu nowego zadania, tak aby podgląd pokazywał przebieg pracy na bieżąco, a nie dopiero po jej zakończeniu.

## ADDED Requirements

### Requirement: Podgląd uruchamia się jednym poleceniem
Użytkownik SHALL móc uruchomić podgląd jednym poleceniem w katalogu repozytorium. Polecenie MUST wypisać adres strony na `localhost` i działać do przerwania. Podgląd MUST czytać ten sam katalog danych, do którego pisze integracja z Claude Code, i MUST NOT nasłuchiwać na adresach innych niż lokalne.

#### Scenario: Uruchomienie z otwartym zadaniem
- **WHEN** użytkownik uruchamia podgląd w katalogu, w którym integracja zapisała zadanie
- **THEN** polecenie wypisuje adres `http://localhost:<port>`, a strona pod tym adresem pokazuje opis bieżącego zadania

#### Scenario: Uruchomienie bez zadania
- **WHEN** użytkownik uruchamia podgląd, a nie rozpoczęto żadnego zadania
- **THEN** strona informuje, że nie ma jeszcze zadania, i podaje, jak je rozpocząć w Claude Code

#### Scenario: Inny katalog danych i inne zadanie
- **WHEN** użytkownik uruchamia podgląd ze wskazanym katalogiem danych lub identyfikatorem wcześniejszego zadania
- **THEN** strona pokazuje to zadanie zamiast bieżącego

### Requirement: Strona aktualizuje się po nowym zdarzeniu
Gdy w pokazywanym zadaniu pojawia się nowe zdarzenie, otwarta strona SHALL zaktualizować widoki bez ręcznego odświeżania, w ciągu kilku sekund od zapisu. Rozwinięte szczegóły i wybrany widok SHALL pozostać po aktualizacji.

#### Scenario: Agent zapisuje ustalenie w trakcie oglądania
- **WHEN** strona jest otwarta na widoku sprawdzeń z rozwiniętym jednym sprawdzeniem, a agent zapisuje nowe sprawdzenie
- **THEN** nowe sprawdzenie pojawia się na stronie bez odświeżania, widok sprawdzeń pozostaje wybrany, a rozwinięte sprawdzenie pozostaje rozwinięte

#### Scenario: Przerwanie i wznowienie połączenia
- **WHEN** proces podglądu zostaje zatrzymany i uruchomiony ponownie, gdy strona jest otwarta
- **THEN** strona po ponownym uruchomieniu wraca do pokazywania bieżącego stanu zadania bez działania użytkownika

### Requirement: Rozpoczęcie nowego zadania przełącza podgląd
Gdy użytkownik rozpoczyna nowe zadanie przez `/devguide`, a podgląd pokazuje zadanie bieżące, strona SHALL przełączyć się na nowe zadanie. Podgląd uruchomiony dla wskazanego zadania SHALL NOT przełączać się.

#### Scenario: Nowe zadanie podczas oglądania bieżącego
- **WHEN** strona pokazuje zadanie bieżące, a użytkownik rozpoczyna nowe zadanie w Claude Code
- **THEN** strona pokazuje opis nowego zadania i jego pierwsze zdarzenie

#### Scenario: Nowe zadanie podczas oglądania wskazanego
- **WHEN** podgląd uruchomiono dla wcześniejszego zadania, a użytkownik rozpoczyna nowe
- **THEN** strona nadal pokazuje wskazane zadanie

### Requirement: Dane podglądu są dostępne jako JSON
Proces podglądu SHALL udostępniać pod lokalnym adresem dane, z których strona buduje widoki: zadanie, zdarzenia i model widoków (elementy przebiegu, karty poprawek, stan sprawdzeń). Dane te MUST być wystarczające do zbudowania widoków bez ponownej interpretacji pliku zadania.

#### Scenario: Odczyt danych narzędziem spoza przeglądarki
- **WHEN** skrypt pobiera dane podglądu z lokalnego adresu
- **THEN** otrzymuje poprawny JSON z zadaniem, listą zdarzeń i modelem widoków, w którym karta poprawki zawiera fragment przed i po z zapisu narzędzia oraz tekst objaśnienia od agenta
