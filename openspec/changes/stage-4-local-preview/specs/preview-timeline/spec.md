# Spec Delta

## Purpose

Widok „Przebieg”: historia znaczących kroków jednego zadania po lewej i własny widok wybranego kroku po prawej, według makiety produktu. Po kliknięciu kroku użytkownik rozumie, co się wydarzyło i jakie ma to znaczenie, bez samodzielnego interpretowania poleceń terminalowych. Wcześniejsze ustalenia pozostają, gdy późniejsze badanie je podważy; brakujących informacji nie uzupełnia się wymyślonymi wynikami.

## ADDED Requirements

### Requirement: Układ nagłówek, zakładki, historia i widok kroku
Widok SHALL mieć nagłówek zadania (nazwa repozytorium i identyfikator zadania, tytuł, cel, jedna linia stanu), zakładki „Przebieg”, „Kod AI”, „Wyniki sprawdzeń”, a w „Przebiegu” dwie kolumny: historię kroków po lewej (czas, tytuł, krótki podtytuł, wybrany krok wyróżniony) i widok wybranego kroku po prawej. Na małym ekranie użytkownik SHALL nadal móc wybrać krok i czytelnie otworzyć jego widok.

#### Scenario: Wybór kroku
- **WHEN** użytkownik klika krok w historii
- **THEN** prawa kolumna pokazuje widok tego kroku, a krok jest wyróżniony w historii

#### Scenario: Mały ekran
- **WHEN** szerokość okna nie mieści dwóch kolumn
- **THEN** historia i widok kroku układają się jedno pod drugim, wybór kroku otwiera jego widok, a powrót do historii jest możliwy jednym kliknięciem

#### Scenario: Nowy krok w trakcie oglądania
- **WHEN** użytkownik ogląda najnowszy krok, a w zadaniu pojawia się kolejny
- **THEN** widok przechodzi na nowy krok; gdy użytkownik wybrał wcześniejszy krok ręcznie, wybór pozostaje

### Requirement: Historia zawiera znaczące zdarzenia zadania
Historia SHALL składać się ze znaczących kroków: zgłoszenie zadania, ustalenia agenta (obserwacja, podejrzenie i jego rozstrzygnięcie, propozycja, przygotowana poprawka, sprawdzenie), zmiany w kodzie i decyzje użytkownika. Gdy zadanie ma zapisane ustalenia, nieprzypisane polecenia i wypowiedzi agenta SHALL być źródłami kroku, do którego prowadziły (następnego w czasie, a gdy go nie ma, ostatniego).

#### Scenario: Polecenia przed obserwacją
- **WHEN** agent uruchomił dwa polecenia, a potem zapisał obserwację
- **THEN** historia ma krok obserwacji, a oba polecenia są w jego źródłach, nie jako osobne kroki

### Requirement: Zadanie bez ustaleń dostaje kroki odtworzone z działań narzędzi
Gdy zadanie nie ma żadnego ustalenia agenta, historia SHALL zawierać po jednym krótkim, rzeczowym kroku na każde zarejestrowane działanie narzędzia, zbudowanym wyłącznie z tego, co narzędzie zwróciło: zmieniony plik z fragmentem przed i po, albo polecenie z plikiem, którego dotyczy (gdy da się go odczytać z treści), i z pierwszym wierszem wyjścia. Krok MUST NOT dopisywać intencji ani rezultatu, których dziennik nie zawiera, i MUST mówić, że AI nie zapisało, po co wykonało działanie.

#### Scenario: Zamiana tekstu przez polecenia
- **WHEN** zadanie zawiera zgłoszenie, trzy polecenia (utworzenie pliku, zamiana słowa, `echo done`) i komunikat agenta, bez ustaleń
- **THEN** historia ma krok „Zgłoszono zadanie” i trzy kroki poleceń: dwa nazwane plikiem, którego dotyczą, z wyjściem „hello” i „greetings”, i jeden z wyjściem „done”; żaden nie twierdzi, co miało zostać osiągnięte, a treść poleceń jest w źródłach

#### Scenario: Polecenie bez wyjścia
- **WHEN** zadanie bez ustaleń zawiera polecenie, które nic nie wypisało
- **THEN** krok mówi, że polecenie nie wypisało nic, i nie przypisuje mu żadnego rezultatu

#### Scenario: Ustalenia pojawiają się później
- **WHEN** w zadaniu z krokami odtworzonymi z poleceń agent zapisuje pierwszą obserwację
- **THEN** polecenia poprzedzające obserwację stają się jej źródłami, a historia pokazuje krok obserwacji zamiast kroków poleceń

#### Scenario: Zmiana kodu bez objaśnienia
- **WHEN** agent zmienił plik narzędziem edycji i nie zapisał objaśnienia
- **THEN** historia ma krok „Zmieniono plik <ścieżka>” z podtytułem „bez objaśnienia od AI”, którego widok pokazuje fragment przed i po

### Requirement: Każdy krok ma własny widok z odpowiednim konkretem
Widok kroku SHALL zawierać krótkie wyjaśnienie oraz wyłącznie elementy potrzebne temu krokowi: dane lub przykład od AI, fragment przed i po, fragment kodu z odsyłaczem do „Kodu AI”, wynik sprawdzenia z dowodem i wyjściem, albo propozycję decyzji. Widok SHALL NOT pokazywać pustych sekcji ani pól „brak”.

#### Scenario: Krok sprawdzenia
- **WHEN** użytkownik wybiera krok sprawdzenia ze statusem „przeszło”
- **THEN** widok pokazuje, co sprawdzono, oczekiwanie, status, cytowany dowód i wyjście wykonania oznaczone jako wynik narzędzia, bez pól niezwiązanych ze sprawdzeniem

#### Scenario: Krok zmiany w kodzie
- **WHEN** użytkownik wybiera krok zmiany z objaśnieniem obejmującej dwa fragmenty
- **THEN** widok pokazuje cel, fragmenty przed i po z narzędzia, mechanizm i odsyłacz „Przejrzyj 2 fragmenty kodu z objaśnieniami”

#### Scenario: Przykład od AI
- **WHEN** krok ma materiał dołączony przez agenta
- **THEN** materiał jest pokazany z podpisem, że to przykład od AI, a nie wynik sprawdzenia

### Requirement: Wyjaśnienia są powiązane ze zdarzeniami, wynikami i wersją kodu
Każdy widok kroku SHALL udostępniać w rozwijanych źródłach zdarzenia, z których powstał: czas, pochodzenie, treść poleceń i pełne wyjścia, wypowiedzi agenta, identyfikatory i wersję kodu. Główna treść SHALL NOT zawierać tych surowych danych. Wcześniejsze ustalenia SHALL pozostać w historii, gdy późniejsze je podważą, a brakujące informacje SHALL być nazwane jako brakujące, nigdy uzupełnione.

#### Scenario: Źródła kroku
- **WHEN** użytkownik rozwija źródła kroku obserwacji poprzedzonej poleceniem
- **THEN** widzi treść polecenia, jego pełne wyjście, czas, pochodzenie, identyfikatory zdarzeń i wersję kodu

#### Scenario: Podważone ustalenie
- **WHEN** podejrzenie zostało odrzucone, a potem zapisano nowe
- **THEN** historia pokazuje podejrzenie z podtytułem „odrzucone”, krok odrzucenia z powodem i nowe podejrzenie, w kolejności czasu

#### Scenario: Brak wyniku
- **WHEN** sprawdzenie zostało zapisane bez zarejestrowanego wykonania
- **THEN** widok kroku mówi, że wykonania nie zarejestrowano i że wynik jest tylko deklaracją AI, bez pokazywania wymyślonego wyjścia

### Requirement: Główny widok bez liczników, legend i surowych wypowiedzi
Główny widok SHALL NOT zawierać liczników pustych kategorii, legend audytowych, surowych wypowiedzi agenta ani nagłówków zliczających polecenia. Linia stanu w nagłówku SHALL rozdzielać stan wykonania (agent pracuje, agent zakończył turę i czeka na odpowiedź, sesja zakończona) od stanu weryfikacji (ile sprawdzeń potwierdza bieżący kod, ile jest niepotwierdzonych, albo brak zapisanych sprawdzeń) i SHALL pomijać kategorie o zerowej liczbie.

#### Scenario: Zadanie bez hipotez i decyzji
- **WHEN** zadanie ma jedno sprawdzenie, które przeszło, i nic więcej
- **THEN** linia stanu mówi, że jedno sprawdzenie potwierdza bieżący kod, i nie wspomina o hipotezach ani decyzjach

#### Scenario: Sesja zakończona bez sprawdzeń
- **WHEN** sesja Claude Code zakończyła się, a zadanie nie ma zapisanych sprawdzeń
- **THEN** linia stanu mówi, że sesja jest zakończona i że nie ma zapisanych sprawdzeń, a nie że zadanie nadal trwa

#### Scenario: Komunikat agenta
- **WHEN** agent zakończył turę komunikatem
- **THEN** komunikat nie jest osobnym krokiem ani elementem głównego widoku, a jest dostępny w źródłach kroku, do którego należy

### Requirement: Przyciski decyzji tylko gdy potrzebne i oznaczone jako demonstracja
Przyciski decyzji („Zatwierdź i zastosuj lokalnie”, „Odeślij do poprawy”) SHALL pojawiać się wyłącznie w widoku kroku przygotowanej poprawki, która nie została zastosowana. Dopóki sterowanie agentem nie jest podłączone, przyciski MUST być wyraźnie oznaczone jako demonstracyjne i MUST NOT zmieniać dziennika ani repozytorium.

#### Scenario: Przygotowana poprawka
- **WHEN** użytkownik wybiera krok przygotowanej, niezastosowanej poprawki
- **THEN** widok pokazuje łatkę, informację „Poprawka nie została zastosowana” i przyciski z podpisem, że to demonstracja bez wpływu na agenta

#### Scenario: Krok bez decyzji
- **WHEN** użytkownik wybiera krok obserwacji lub sprawdzenia
- **THEN** widok nie pokazuje żadnych przycisków decyzji

### Requirement: Oszczędny wygląd
Strona SHALL używać ciemnego tła, jednego koloru akcentowego, delikatnych separatorów, niewielu obramowań i krótkich tekstów, tak jak makieta produktu.

#### Scenario: Elementy akcentowane
- **WHEN** strona jest wyświetlona
- **THEN** akcent występuje tylko na aktywnej zakładce, odsyłaczach, linii stanu i statusach pozytywnych; ostrzeżenia mają jeden osobny kolor
