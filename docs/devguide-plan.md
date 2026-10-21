# DevGuide — plan realizacji dla agenta AI

Chcę zbudować **DevGuide** — toolset pomagający deweloperowi rozumieć i kontrolować pracę AI nad kodem. Przygotuj repozytorium i wdrażaj projekt etapami.

Obecnie projekt ma koncepcję i interaktywne makiety. Nie zakładaj, że istnieje już działająca integracja z agentem, repozytorium lub narzędziami weryfikacji. Pierwszym krokiem jest repozytorium i działający przepływ techniczny; prawdziwy ticket będzie sprawdzianem pierwszej wersji.

## Cel produktu

Użytkownik podaje zadanie agentowi kodującemu i na bieżąco widzi w lokalnym podglądzie:

- jaki problem badamy i jakie są konkretne przykłady;
- co ustalono o przyczynie oraz co nadal jest przypuszczeniem;
- jakie rozwiązanie proponuje AI;
- jakie fragmenty kodu zmienia, po co i jak one działają;
- jakie decyzje wymagają odpowiedzi użytkownika;
- co faktycznie sprawdzono i czego nadal nie wiadomo.

Podgląd ma przedstawiać przebieg pracy, a po zakończeniu umożliwiać przejrzenie całości. Nie może być wyłącznie raportem wygenerowanym na końcu.

Rozwiązanie ma być uniwersalne: dla backendu, frontendu, data engineeringu i innych projektów. Nie uzależniaj go od firmowego AI QA ani konkretnego systemu testowania.

## Najważniejsze zasady

1. Używaj prostego języka. Pokazuj „Generator zapisał wszystkie 250 rekordów”, zamiast „Sprawdzenie R-02 zakończone sukcesem”. Identyfikatory techniczne pozostają w szczegółach.
2. Pokazuj przykładowe dane, wyniki i kod. Wyraźnie odróżniaj ilustrację od rzeczywistego wyniku.
3. Oddzielaj obserwacje narzędzi od interpretacji AI.
4. Wiąż wyjaśnienia i wyniki z konkretną wersją kodu.
5. Zachowuj historię błędnych hipotez i zmienionych ustaleń.
6. Nie zakładaj istnienia testów ani firmowego systemu QA.
7. OpenSpec jest opcjonalny. Wykorzystuj jego ustalenia, jeśli istnieją; nie wymagaj go dla małych poprawek.
8. Interfejs ma być spokojny i przejrzysty: minimalistyczny dark mode, jeden akcent, listy i separatory, szczegóły rozwijane na żądanie.
9. Nigdy nie przedstawiaj symulowanej blokady jako rzeczywistego mechanizmu kontroli.

## Etap 1 — repozytorium i zakres pierwszej wersji

Utwórz lokalne repozytorium Git. Przygotuj:

- README z celem, zakresem i sposobem uruchomienia;
- instrukcje dla agenta pracującego nad projektem;
- krótki plan implementacji;
- katalogi na integrację z agentem, lokalny proces, interfejs i przykładowe zadanie;
- podstawowe sprawdzenia uruchamiane w CI.

Dobierz możliwie prosty stack i krótko uzasadnij wybór. Pierwsza wersja ma obsługiwać **jednego użytkownika, jedno zadanie, jedno repozytorium i Claude Code**.

Nie dodawaj kont użytkowników, chmury, zarządzania zespołami ani obsługi wielu agentów. Publikacja zdalnego repozytorium wymaga wskazania konta lub organizacji oraz widoczności repo.

## Etap 2 — sprawdzenie możliwości integracji

Sprawdź aktualną dokumentację Claude Code i ustal:

- jak uruchomić skill prowadzący;
- jak odbierać informacje o wykonanych działaniach;
- jak rejestrować zmiany plików i wyniki poleceń;
- czy i jak można zatrzymać określoną operację przed wykonaniem;
- jak wznowić zadanie po przerwaniu sesji.

Przygotuj mały eksperyment potwierdzający działanie integracji. Nie projektuj dalszej architektury na podstawie niezweryfikowanych założeń.

## Etap 3 — zapis przebiegu zadania

Wprowadź prosty zapis zdarzeń i załączonych materiałów. Zdarzenia powinny obejmować m.in.:

- obserwację problemu;
- hipotezę i jej późniejsze potwierdzenie lub odrzucenie;
- propozycję rozwiązania;
- przygotowaną lub zastosowaną zmianę;
- decyzję użytkownika;
- wykonane sprawdzenie i jego wynik.

Zapisuj pochodzenie informacji, czas, powiązane pliki i wersję kodu. Zdarzenia powinny pozwalać odtworzyć przebieg oraz wznowić pracę.

Interpretacja AI nie może sama tworzyć statusu „test przeszedł”. Taki status wymaga zarejestrowanego wykonania i wyniku. Sam kod wyjścia 0 nie wystarcza do stwierdzenia poprawności zachowania produktu.

## Etap 4 — lokalny podgląd

Zbuduj podgląd aktualizowany po nowych zdarzeniach. Powinien mieć trzy główne widoki:

| Widok | Zawartość |
| --- | --- |
| **Przebieg** | Historia odkryć, propozycji, decyzji i wyników. Kliknięcie zdarzenia pokazuje jego kontekst i przykłady. |
| **Kod AI** | Logiczne poprawki, fragmenty przed/po, proste objaśnienia i przykłady działania. |
| **Wyniki sprawdzeń** | Co uruchomiono, jaki otrzymano wynik, czego dotyczy i jakie ma ograniczenia. |

Nie narzucaj sztywnej liczby etapów. Historia musi obsługiwać powrót do badania problemu, odrzucenie hipotezy i poprawianie wcześniejszego rozwiązania.

W zakładce „Kod AI” użytkownik powinien móc kliknąć fragment i zobaczyć, co robi oraz dlaczego go zmieniono. Dostępny musi być również pełny diff.

Każda logiczna poprawka powinna mieć osobną kartę z:

- lokalizacją w kodzie;
- fragmentem przed i po zmianie;
- wyjaśnieniem celu i mechanizmu;
- przykładem wejścia, wyniku lub zmiany danych;
- istotnymi założeniami i ograniczeniami.

W głównym widoku używaj określeń „przed poprawką” i „po poprawce”. Techniczne identyfikatory wersji udostępniaj w szczegółach. Wyraźnie pokazuj, jeśli późniejsza zmiana kodu sprawia, że wcześniejsze wyniki nie potwierdzają już bieżącego rozwiązania.

## Etap 5 — skill prowadzący

Przygotuj jeden główny skill, który prowadzi zadanie i korzysta z instrukcji dotyczących:

- rozpoznania problemu;
- planowania;
- implementacji;
- weryfikacji;
- wyjaśniania zmian.

Nie twórz osobnych agentów, jeśli nie ma uzasadnionej potrzeby.

Skill ma przekazywać ustrukturyzowane ustalenia do lokalnego procesu. Informacje o faktycznych zmianach i wykonanych poleceniach należy, gdzie to możliwe, zbierać bezpośrednio z narzędzi.

Użytkownik powinien rozpoczynać zadanie przez jedno wejście — roboczo `/devguide`. Konkretna forma komendy zależy od możliwości integracji potwierdzonych w etapie 2.

## Etap 6 — decyzje użytkownika

Zaimplementuj jeden dobrze określony punkt kontroli, którego skuteczność można przetestować.

Preferowany przykład: użytkownik przegląda przygotowaną poprawkę i zatwierdza jej zastosowanie. Zgoda dotyczy konkretnej zawartości; zmiana poprawki lub kodu bazowego wymaga ponownego sprawdzenia zgodności.

Jeżeli integracja nie pozwala wiarygodnie egzekwować zatrzymania, jasno opisz ograniczenie i zaproponuj wykonalny wariant. Nie zastępuj blokady samą instrukcją w prompcie.

Rozróżniaj propozycję, zmianę zastosowaną lokalnie i wdrożenie. Nie wymagaj zgody na każdą drobną czynność.

Dodatkowe zachowanie wykryte po zmianie kodu musi być oznaczone jako wykryte po fakcie. Nie przedstawiaj go jako decyzji zatrzymanej przed wykonaniem.

## Etap 7 — działający przykład od początku do końca

Przygotuj niewielki projekt demonstracyjny z rzeczywistym błędem: eksport pobiera tylko pierwszą stronę danych.

Przeprowadź zadanie przez DevGuide:

1. Odtwórz brak rekordów.
2. Zbierz obserwacje i ustal przyczynę.
3. Pokaż propozycję oraz kod poprawki.
4. Obsłuż decyzję użytkownika.
5. Zastosuj zmianę.
6. Uruchom sprawdzenia.
7. Pokaż wyniki i ograniczenia.

Dane mogą być syntetyczne, ale kod, jego zmiany i wykonanie sprawdzeń mają być rzeczywiste. Ręcznie wpisane wyniki są dopuszczalne wyłącznie w wyraźnie oznaczonej demonstracji interfejsu.

Przykładowe sprawdzenia:

- 250 klientów rozłożonych na trzy strony daje 250 rekordów bez duplikatów;
- filtry obowiązują przy pobieraniu każdej strony;
- błąd drugiej strony nie powoduje zapisania niepełnego pliku;
- odrzucenie propozycji nie powoduje zastosowania zmian;
- zmiana kodu po sprawdzeniu nie pozostawia bezwarunkowego statusu potwierdzenia dla nowej wersji.

## Etap 8 — pilotaż na prawdziwym tickecie

Dopiero po działającym przykładzie zastosuj toolset do małego zadania w rzeczywistym repozytorium.

Oceń, czy użytkownik potrafi wyjaśnić:

- jaka była przyczyna problemu;
- jak działa poprawka;
- jakie decyzje podjęto;
- jakie zachowania sprawdzono;
- czego nadal nie wiadomo;
- gdzie zmodyfikować rozwiązanie w przyszłości.

Zanotuj również, ile dodatkowej pracy wymagało użycie DevGuide.

## Sposób realizacji

Pracuj małymi, działającymi przyrostami. Najpierw doprowadź do przepływu: **działanie agenta → zapis zdarzenia → aktualizacja podglądu**. Następnie dodawaj kolejne funkcje.

Po każdym etapie przedstaw krótko: co działa, jak to sprawdzono, jakie są ograniczenia i jaki jest następny krok. Utrzymuj dokumentację proporcjonalną do projektu.

Nie traktuj opisów makiety jako potwierdzenia możliwości technicznych integracji. Nie obiecuj automatycznego wykrycia każdej nieuzgodnionej decyzji biznesowej. Mechanizm kontroli ma mieć jasno określony i przetestowany zakres.

## Kryterium sukcesu pierwszej wersji

Użytkownik widzi rzeczywisty przebieg pracy nad poprawką, rozumie zmieniony kod dzięki przykładom i potrafi odróżnić ustalenia AI od wyników wykonanych sprawdzeń.

Podgląd nie jest terminalowym black boxem ani kolejną ścianą dokumentacji. Pomaga przejąć rozwiązanie i dalej nad nim pracować.
