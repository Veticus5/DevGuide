# agent-activity-log Specification

## Purpose

Lokalny dziennik, w którym integracja z Claude Code zapisuje, co agent faktycznie zrobił: granice sesji, każde użycie narzędzia, zmiany plików, polecenia i ich wyniki. Wpisy pochodzą z narzędzi, nie z opisu agenta, i są powiązane z czasem, sesją i wersją kodu.

## Requirements

### Requirement: Każde użycie narzędzia trafia do dziennika
Integracja SHALL zapisać w lokalnym dzienniku wpis dla każdego użycia narzędzia przez agenta, zawierający czas, identyfikator sesji, nazwę narzędzia, dane wejściowe i wynik zwrócony przez narzędzie. Wpis powstaje bez udziału agenta w opisywaniu własnego działania.

#### Scenario: Agent używa narzędzia
- **WHEN** agent w sesji Claude Code wywołuje dowolne narzędzie (np. odczyt pliku)
- **THEN** w dzienniku pojawia się wpis z czasem, identyfikatorem sesji, nazwą narzędzia i danymi wejściowymi, a po zakończeniu narzędzia drugi wpis z jego wynikiem

#### Scenario: Agent nie opisuje działania
- **WHEN** agent wykonuje narzędzie, ale w odpowiedzi tekstowej nie wspomina o nim lub opisuje je nieprawdziwie
- **THEN** dziennik i tak zawiera wpis zgodny z tym, co narzędzie faktycznie dostało i zwróciło

### Requirement: Zmiana pliku jest zapisana ze ścieżką
Integracja SHALL zapisać dla każdej zmiany pliku wykonanej przez agenta ścieżkę zmienionego pliku oraz treść zmiany w postaci, w jakiej zwraca ją narzędzie.

#### Scenario: Agent tworzy plik
- **WHEN** agent tworzy nowy plik narzędziem zapisu
- **THEN** wpis w dzienniku zawiera ścieżkę pliku i oznaczenie, że plik został utworzony

#### Scenario: Agent edytuje plik
- **WHEN** agent zmienia fragment istniejącego pliku
- **THEN** wpis w dzienniku zawiera ścieżkę pliku oraz fragment przed i po zmianie, o ile narzędzie je udostępnia; jeśli nie udostępnia, wpis zawiera to, co narzędzie zwróciło, a brak jest odnotowany w dokumencie ustaleń

### Requirement: Polecenie jest zapisane z treścią i wynikiem
Integracja SHALL zapisać dla każdego polecenia uruchomionego przez agenta jego treść oraz wynik zwrócony przez narzędzie (wyjście standardowe, wyjście błędów i kod wyjścia, o ile narzędzie go udostępnia).

#### Scenario: Polecenie kończy się powodzeniem
- **WHEN** agent uruchamia polecenie, które wypisuje tekst i kończy się poprawnie
- **THEN** wpis w dzienniku zawiera treść polecenia i wypisany tekst

#### Scenario: Polecenie kończy się błędem
- **WHEN** agent uruchamia polecenie, które kończy się niepowodzeniem
- **THEN** wpis w dzienniku zawiera treść polecenia i informację o niepowodzeniu wraz z komunikatem błędu

### Requirement: Granice sesji są widoczne w dzienniku
Integracja SHALL zapisać początek sesji z informacją, czy to nowa sesja czy wznowienie, koniec sesji oraz zakończenie każdej tury agenta wraz z jego ostatnią wypowiedzią oznaczoną jako wypowiedź agenta.

#### Scenario: Nowa sesja
- **WHEN** użytkownik uruchamia nową sesję Claude Code w repozytorium
- **THEN** dziennik zawiera wpis o starcie sesji oznaczony jako nowa sesja, z identyfikatorem tej sesji

#### Scenario: Wznowienie sesji
- **WHEN** użytkownik wznawia wcześniejszą sesję po jej przerwaniu
- **THEN** dziennik zawiera wpis o starcie oznaczony jako wznowienie, z tym samym identyfikatorem sesji co wpisy sprzed przerwania, a agent ma dostęp do ustaleń sprzed przerwania

#### Scenario: Koniec tury agenta
- **WHEN** agent kończy turę i oddaje głos użytkownikowi
- **THEN** dziennik zawiera wpis z ostatnią wypowiedzią agenta oznaczoną jako wypowiedź agenta, odróżnialną od wpisów pochodzących z narzędzi

### Requirement: Każdy wpis wskazuje wersję kodu
Każdy wpis w dzienniku SHALL zawierać identyfikator bieżącej wersji kodu repozytorium (commit), na której wykonano działanie, albo wyraźne oznaczenie, że wersja jest nieznana.

#### Scenario: Repozytorium Git
- **WHEN** działanie odbywa się w katalogu będącym repozytorium Git
- **THEN** wpis zawiera identyfikator bieżącego commita

#### Scenario: Brak repozytorium Git
- **WHEN** działanie odbywa się w katalogu, który nie jest repozytorium Git
- **THEN** wpis zawiera oznaczenie nieznanej wersji, a zapis nie kończy się błędem

### Requirement: Dziennik nie przerywa pracy agenta
Zapis do dziennika SHALL NOT blokować ani opóźniać w zauważalny sposób działania agenta; błąd zapisu MUST być zgłoszony na wyjściu diagnostycznym, a działanie agenta MUST być kontynuowane.

#### Scenario: Nie można zapisać dziennika
- **WHEN** katalog dziennika jest niedostępny do zapisu
- **THEN** wywołanie narzędzia przez agenta przebiega normalnie, a informacja o nieudanym zapisie jest dostępna w diagnostyce

### Requirement: Dziennik leży poza wersjonowanym kodem
Dziennik SHALL być zapisywany w katalogu roboczym repozytorium w miejscu ignorowanym przez Git, tak aby zapisy nie trafiały do historii kodu ani do przeglądu zmian.

#### Scenario: Stan repozytorium po sesji
- **WHEN** po sesji agenta użytkownik sprawdza stan repozytorium Git
- **THEN** pliki dziennika nie są pokazywane jako nowe ani zmienione
