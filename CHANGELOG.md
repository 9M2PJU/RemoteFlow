# Historia zmian – RemoteFlow

Numer wersji: `MAJOR.MINOR.PATCH`. Każda zmiana podnosi co najmniej numer PATCH.
Wersja jest zapisana w trzech plikach, które muszą być zgodne (pilnuje tego test `version_tests` w `src-tauri/src/lib.rs`):
`package.json` (wyświetlana w aplikacji), `src-tauri/tauri.conf.json` (instalator) i `src-tauri/Cargo.toml`.

## 1.6.6 – zakres eksportu połączeń
- Eksport obejmuje wszystkie połączenia albo zaznaczone grupy wraz z podgrupami. Można osobno dołączyć połączenia bez grupy; formularz pokazuje liczbę eksportowanych połączeń i folderów.
- Eksport podgrupy zachowuje foldery nadrzędne potrzebne do odtworzenia ścieżki, bez eksportowania innych połączeń nadrzędnych i sąsiednich grup. Do eksportu częściowego trafiają tylko używane profile poświadczeń.
- Wybór zakresu działa dla szyfrowanych plików `.rfvault` i jawnych plików JSON. Pusty lub nieaktualny wybór grup nie przełącza eksportu na całą bazę.

## 1.6.5 – klonowanie połączeń
- „Klonuj połączenie” w strukturze połączeń (przycisk przy wpisie i menu pod prawym przyciskiem myszy) tworzy zapisany wpis obok oryginału, w tej samej grupie, z nowym identyfikatorem i dopiskiem „(kopia)”. Kolejne kopie mają numer, np. „(kopia 2)”.
- Kopia zachowuje konfigurację, tunele, tagi, notatki, ustawienia RDP i SFTP oraz zaszyfrowane hasła i klucze. Współdzielony profil poświadczeń pozostaje powiązany. Oryginał nie jest zmieniany; klonowanie nie uruchamia sesji.

## 1.6.4 – grupy i pełny tekst na liście sesji
- Lista otwartych sesji pokazuje grupę połączenia, wraz z pełną ścieżką zagnieżdżonych folderów. Połączenia poza grupami są oznaczone „Bez grupy”. Wyszukiwanie uwzględnia także nazwy grup.
- Nazwa sesji, dane hosta i ścieżka grupy przewijają się automatycznie, gdy przekraczają szerokość wiersza. Krótki tekst pozostaje nieruchomy; przy ograniczeniu animacji w ustawieniach systemu tekst można przewijać ręcznie.

## 1.6.3 – nawigacja między wieloma sesjami
- Pasek zakładek ma przyciski przewijania w lewo i w prawo. Nieaktywny przycisk sygnalizuje początek lub koniec paska.
- Przycisk z liczbą otwartych sesji pokazuje wszystkie zakładki, ich hosty, użytkowników, protokoły oraz stan połączenia. Wyszukiwarka i obsługa klawiatury ułatwiają odnalezienie i wybranie sesji, również w podzielonym widoku.
- Wybrana zakładka jest automatycznie odsłaniana na pasku. Rozmiar paska i dostępność przewijania aktualizują się po zmianie rozmiaru okna, otwarciu, zamknięciu i przestawieniu zakładek.

## 1.6.2 – monit o puste hasło
- Przed logowaniem hasłem aplikacja sprawdza w backendzie efektywne hasło połączenia, uwzględniając profil poświadczeń i zaszyfrowany pusty ciąg. Brak hasła otwiera monit z wyborem: próba bez hasła, zapis nowego hasła i połączenie lub anulowanie.
- Nowe hasło jest szyfrowane i zapisywane wyłącznie w wybranym połączeniu, bez zmiany współdzielonego profilu ani pozostałych ustawień. Wybór pustego hasła dotyczy bieżącej sesji; kolejna nowa sesja wymaga ponownego wyboru.
- Monit obejmuje SSH z logowaniem hasłem oraz RDP (IronRDP, FreeRDP wbudowany i osobny). SSH używające klucza, certyfikatu lub agenta nie wymaga takiego monitu. Przy połączeniach grupowych monity są obsługiwane kolejno; blokada aplikacji anuluje oczekujące próby.

## 1.6.1 – poprawki bezpieczeństwa i połączeń
- Struktura połączeń zapamiętuje zwinięte grupy po ponownym uruchomieniu. Wyszukiwanie nie zmienia tego ustawienia.
- FreeRDP: błąd niezaufanego lub zmienionego certyfikatu otwiera komunikat z aktualnym odciskiem SHA-256. Po zweryfikowaniu go u administratora można jawnie zaufać certyfikatowi i połączyć się ponownie. Odcisk jest ponownie sprawdzany przed zapisaniem w sejfie, a FreeRDP dostaje konkretny zaakceptowany odcisk zamiast ignorowania błędów certyfikatów. Dotyczy okna wbudowanego i osobnego.
- SFTP: zmiana hosta, portu, użytkownika, metody uwierzytelnienia lub poświadczeń unieważnia sesję z puli. Klucz wpisany w połączeniu ma pierwszeństwo przed kluczem profilu poświadczeń.
- SSH respektuje wybraną metodę uwierzytelnienia, bez niejawnego przechodzenia do hasła lub agenta. Certyfikat OpenSSH jest przekazywany do libssh2 wraz z kluczem prywatnym. Tunele mają włączony keepalive SSH.
- Zamykanie proxy RDP anuluje również aktywnych klientów; negocjacja WebSocket ma limit czasu, a liczba klientów jest ograniczona.
- Sejf v3 szyfruje także nazwy, hosty, użytkowników, notatki, grupy i listę zaufanych serwerów. Migracja starszego sejfu po poprawnym odblokowaniu wymaga utworzenia kopii. Publiczny nagłówek z ustawieniami odblokowania, interfejsu i kopii nadal jest objęty HMAC. Starsze kopie zachowują dotychczasowy format; sejfu v3 nie należy otwierać starszą wersją aplikacji.
- Test kontroli tłumaczeń działa na Windows. Dodano testy regresji oraz etap `verify` w obrazie Docker dla Linuksa.

## 1.6.0 – FreeRDP w oknie aplikacji (Linux)
- **Nowa opcja: Ustawienia → Klient RDP (Linux) → „FreeRDP w oknie”.** Sesja RDP jest wtedy rysowana przez natywnego klienta FreeRDP (wiele wątków, H.264 przez `/gfx`) w zakładce RemoteFlow – nie w osobnym oknie. Jest dużo szybszy od wbudowanego klienta (IronRDP/WebAssembly) przy zmianie okien, wideo i przewijaniu. Domyślnie nadal działa klient wbudowany; zmiana obowiązuje po ponownym uruchomieniu programu.
- Jak to działa: nad obszarem sesji umieszczane jest natywne okno potomne (X11), do którego FreeRDP rysuje (`/parent-window`). Okno podąża za układem (podział ekranu, zmiana rozmiaru) i jest chowane, gdy zakładka nie jest widoczna albo obszar zasłania okno dialogowe. Klawiatura trafia do sesji, gdy kursor znajdzie się nad obrazem; kliknięcie w interfejs RemoteFlow oddaje ją z powrotem. Schowek i dysk `RemoteFlow` (`~/RemoteFlow_Shared`) obsługuje FreeRDP. Pasek sesji: ponowne połączenie, otwarcie w osobnym oknie, po rozłączeniu – ostatnie komunikaty FreeRDP.
- Wymaga X11 i klienta `xfreerdp3`/`xfreerdp` (np. `sudo apt install freerdp3-x11`). W sesji Wayland RemoteFlow uruchamia się przy włączonej opcji przez XWayland (`GDK_BACKEND=x11`, tylko gdy dostępny jest serwer X i zmienna nie jest ustawiona ręcznie).
- Okna-kontenery nie są niszczone po zamknięciu sesji, tylko ukrywane i używane ponownie – zniszczenie okna, w którym było okno FreeRDP, powodowało błąd GDK (segfault) kilka sekund później. Wywołania X11 ustawiające fokus używają osobnego połączenia z serwerem X.

## 1.5.4 – statystyki wydajności RDP
- **Statystyki w oknie RDP** (przycisk z ikoną wykresu na pasku narzędzi): dane z serwera (MB/s), aktualizacje ekranu (regiony/s, Mpx/s), czas rysowania, obciążenie wątku głównego (sonda co 10 ms) i podsumowanie dużych zmian ekranu (np. przełączenie okna): czas, dane, czas zajętości wątku. Przycisk „Kopiuj” kopiuje wyniki jako tekst. Pomiar działa tylko przy otwartym panelu.
- **Wynik pomiarów (serwer RemoteFX `freerdp-shadow`, 1600×900):** wątek główny zajęty ~95% czasu zarówno w WebKitGTK, jak i w Chromium, rysowanie zajmuje ~1% – ograniczeniem jest dekodowanie RemoteFX w IronRDP (WebAssembly, jeden wątek; moduł jest już skompilowany z SIMD), a nie sposób rysowania. Koszt dekodowania rośnie z liczbą pikseli – mniejsza rozdzielczość pulpitu zdalnego lub FreeRDP (H.264, wiele wątków) dają płynniejszy obraz.
- **Poprawka do 1.5.3:** wstrzymywanie obrazu dotyczy tylko aktualizacji złożonych z wielu części. Gdy dekodowanie zajmuje wątek, każda klatka przychodzi jako jeden region – wcześniej mogła być niepotrzebnie wstrzymana do 150 ms.

## 1.5.3 – RDP na Linuksie: obraz bez „doczytywania”
- **Wbudowany klient RDP (WebKitGTK):** duża aktualizacja ekranu (np. przełączenie okna na zdalnym pulpicie) przychodzi w wielu pakietach i była rysowana co klatkę, więc było widać, jak obraz się doczytuje. Teraz, dopóki napływa seria aktualizacji, obraz jest wstrzymywany (maks. 34 ms dla małych zmian, 150 ms dla zmian obejmujących ≥10% ekranu) i pokazywany w całości. Pojedyncze małe zmiany (pisanie, kursor) pojawiają się w kolejnej klatce jak dotąd.
- **FreeRDP (przycisk „Otwórz w FreeRDP” / klient systemowy na Linuksie):** uruchamiany z `/gfx` (potok graficzny – RemoteFX progressive / H.264, jeśli serwer i kompilacja FreeRDP go obsługują) i `/network:auto`. Wbudowany klient (IronRDP w WebAssembly) nie obsługuje GFX/H.264 i dekoduje obraz w jednym wątku, dlatego przy dynamicznej zawartości (wideo, przewijanie dużych okien) FreeRDP pozostaje szybszy.

## 1.5.2 – poprawki z przeglądu kodu
- **Testy nie dotykają prawdziwego sejfu.** Testy jednostkowe używały zwykłego wyszukiwania lokalizacji sejfu (obok programu, katalog roboczy, `~/.config/remoteflow`) i usuwały `vault.json` oraz `backups` – uruchomione na komputerze z prawdziwym sejfem mogły go skasować. Teraz w testach sejf jest zawsze w osobnym katalogu tymczasowym (`remoteflow-test-<pid>`); pilnuje tego test.
- **Zaufane hosty przy zablokowanym sejfie:** odtwarzany tunel nie czyta już listy z niezweryfikowanego pliku. Używana jest lista zapamiętana w pamięci przy ostatnim odczycie zweryfikowanym kluczem (odblokowanie, połączenie, Ustawienia). Wpis podmieniony w pliku podczas blokady jest ignorowany (test). Reset sejfu i przywrócenie kopii czyszczą tę listę.
- **SFTP – pobieranie nie zapisuje przez dowiązania symboliczne.** Gdy w katalogu docelowym istnieje dowiązanie o nazwie pobieranego pliku/katalogu, element jest pomijany z komunikatem (wcześniej `File::create` nadpisałby cel dowiązania, także poza wybranym katalogiem). Plik jest zapisywany do tymczasowego `.<nazwa>.rf-part` (utworzonego z `create_new`) i podmieniany przez zmianę nazwy dopiero po pobraniu – przerwane pobieranie nie niszczy też starej wersji pliku.
- **Terminal SSH nie gubi wysyłanych danych.** Dane z klawiatury i wklejania trafiają do kolejki i są wysyłane w takim tempie, w jakim przyjmuje je kanał; wcześniej `write_all` z 30-ms limitem czasu porzucał resztę, gdy okno kanału było pełne (np. wklejenie dużego tekstu, wolne łącze). Test: 3 MB wklejone do programu, który zaczyna czytać po sekundzie – dawna wersja gubiła dane za każdym razem, nowa przesyła całość.
- **Limit czasu negocjacji SSH (20 s)** obejmuje handshake, sprawdzenie klucza hosta i logowanie – serwer, który przyjmie TCP i nie odpowiada, nie blokuje już wątku na zawsze.
- **Stan sesji SSH zgodny z rzeczywistością:** zakładka jest „łączenie” do zalogowania, potem „połączono”; błąd logowania lub utrata połączenia ustawia „błąd”, zakończenie sesji przez serwer – „rozłączono” (szara kropka). Stan wysyła wątek sesji zdarzeniem `session-status`.
- **Adresy IPv6:** host i port są przekazywane do resolvera osobno, a tam gdzie potrzebny jest napis – w formie `[::1]:22` (SSH, proxy RDP, FreeRDP `/v:`, plik `.rdp`, cel klienta RDP). Wcześniej `::1` dawało błędne `::1:22`.
- Tunele SOCKS5: przy więcej niż 32 jednoczesnych nowych połączeniach kolejne czekają na wolny wątek negocjacji zamiast być odrzucane (test: 100 równoległych połączeń).

## 1.5.1
- **RDP na Linuksie rysuje się kilka razy szybciej.** Przyczyna (zmierzona w WebKitGTK 2.52 z serwerem xrdp): wbudowany klient IronRDP rysuje każdy zmieniony fragment ekranu osobnym wywołaniem `putImageData` – pełnoekranowe zdjęcie to ok. 180 pasków 1600×5 px. W WebView2 (Windows) to łącznie ~2 ms, ale w WebKitGTK każde wywołanie kosztuje stałe ~2 ms, więc obraz 1600×900 rysował się 340–480 ms i było widać, jak ładuje się pasami. Teraz fragmenty trafiają do bufora w pamięci, a ekran jest odświeżany jednym wywołaniem na klatkę: 11–23 ms rysowania, cały obraz pojawia się w 2–3 krokach (`src/utils/rdpCanvasBatching.ts`, włączane tylko w silnikach WebKit).
- Proxy RDP: wyłączony algorytm Nagle'a na lokalnym połączeniu WebSocket (mniej opóźnień przy wielu małych aktualizacjach ekranu).

## 1.5.0 – tunele SSH, terminal, SFTP i poprawki z przeglądu kodu
- **Tunele SSH na nowo (`session/tunnels.rs`).** Wszystkie tunele połączenia (-L, -D, -R) używają jednej wspólnej sesji SSH; każde połączenie TCP to tylko nowy kanał w tej sesji. Wcześniej każde połączenie przez tunel lokalny lub SOCKS5 zestawiało osobne połączenie SSH z pełnym logowaniem – przeglądarka otwierająca kilkadziesiąt połączeń naraz trafiała na limit `MaxStartups` serwera (zrywane połączenia, timeouty). Test: 60 równoległych połączeń SOCKS5 = 1 logowanie na serwerze.
- Tunele obsługują półzamknięcie TCP (half-close): gdy klient skończy wysyłać (np. zapytanie HTTP/SQL), odpowiedź serwera jest dalej przekazywana do końca – wcześniej kanał był zamykany i odpowiedź ucinana. Działa w obu kierunkach.
- Jeden wątek obsługuje wszystkie przekierowane połączenia sesji (tryb nieblokujący); limity: 256 jednoczesnych połączeń, 32 wątki pomocnicze (negocjacja SOCKS, łączenie celu -R). Skaner portów nie wyczerpie już wątków i deskryptorów. Po utracie łączności tunele łączą się ponownie przy następnym połączeniu.
- Terminal SSH: usunięto sztywne odpowiedzi backendu na zapytania terminala (DA, pozycja kursora, kolor tła) – odpowiada na nie xterm.js. Wcześniej serwer dostawał dwie odpowiedzi (druga pojawiała się jako przypadkowe znaki, np. `1;2c`), a kolor tła zawsze był „ciemny”, także w jasnym motywie. Polskie znaki rozdzielone między dwa odczyty z kanału nie zamieniają się już w `�`.
- Okno połączenia → Tunele: dla tunelu zdalnego (-R) pola opisane są „Port na serwerze” i „Cel na tym komputerze” (wcześniej mylące „Port lokalny” / „Zdalny”); podpowiedzi wyjaśniają kierunek każdego typu. Opis tuneli na zakładce pokazuje typ (`-L`, `-R`, `-D`).
- SFTP: dowiązania symboliczne są widoczne na liście (ikona łańcucha, kursywa, typ i rozmiar celu) – lokalnie i na serwerze. Przy kopiowaniu dowiązanie do pliku jest kopiowane z zawartością; dowiązanie do katalogu jest śledzone, gdy zaznaczysz je bezpośrednio, a wewnątrz kopiowanego katalogu jest pomijane (pętle) i liczone w podsumowaniu („pominięto dowiązań do katalogów”). Uszkodzone dowiązania są zgłaszane jako błąd. Na Windows ukryte elementy systemowe (stare skróty-junction w profilu, np. „Application Data”) nie są pokazywane.
- Import z mRemoteNG: połączenia VNC, Telnet, HTTP i inne nieobsługiwane protokoły są pomijane z komunikatem (np. „VNC × 3”) – wcześniej VNC stawało się połączeniem RDP na porcie 5900.
- Hasło RDP nie jest już przechowywane w danych sesji (`session_list`). Wbudowany klient pobiera je z sejfu w chwili łączenia (`session_rdp_password`), więc po zablokowaniu sejfu nie da się go odczytać.
- Menu kontekstowe otwierane w nowym miejscu nie miga już przez chwilę w poprzednim.

## 1.4.4
- Linux: domyślnie znów szybkie renderowanie przez GPU (DMA-BUF). Tryb zgodny (wolniejszy, bez błędu `DRM_IOCTL_MODE_CREATE_DUMB` / `GBM buffer`) wybiera się w Ustawieniach → Motyw kolorystyczny → „Renderowanie okna (Linux)”; działa po ponownym uruchomieniu. Wybór jest zapisany w `display.json` obok `vault.json` (musi być znany przed otwarciem okna, więc nie jest w zaszyfrowanym sejfie). Jednorazowo można go wymusić zmienną `REMOTEFLOW_SAFE_RENDERING=1` – przydatne, gdy okno w ogóle się nie rysuje.

## 1.4.3
- Linux (Ubuntu): błąd `KMS: DRM_IOCTL_MODE_CREATE_DUMB failed: Brak dostępu` / `Failed to create GBM buffer` (pusty lub migający ekran). WebKitGTK 2.42+ próbuje rysować przez bufory DMA-BUF karty graficznej, co nie działa m.in. ze sterownikami NVIDIA, w maszynach wirtualnych i bez dostępu do `/dev/dri`. Aplikacja wyłącza teraz ten tryb przy starcie (`WEBKIT_DISABLE_DMABUF_RENDERER=1`), chyba że zmienna jest już ustawiona. Kto chce wrócić do renderowania przez GPU, uruchamia program z `REMOTEFLOW_WEBKIT_DMABUF=1`.

## 1.4.2
- Menu kontekstowe (prawy przycisk myszy) mieszczą się zawsze w oknie: gdy pod kursorem brakuje miejsca, menu otwiera się nad kursorem, a przy prawej krawędzi – na lewo od niego. Dotyczy drzewa „Struktura połączeń” (np. połączenie na samym dole listy), zakładek, terminala SSH i okna SFTP (wspólny hook `src/utils/useMenuPosition.ts`).

## 1.4.1
- Jasny motyw z ciemnym terminalem: przyciski nad terminalem („Pliki (SFTP)”, „Tunele”, powiadomienia) były prawie niewidoczne (ciemny tekst na ciemnym terminalu). Pasek nad terminalem używa teraz kolorów terminalu – ciemnych, gdy terminal jest ciemny, i jasnych przy jasnym terminalu. Przycisk „Pliki (SFTP)” ma też własne tło (wcześniej przezroczyste).
- Blok kolorów jasnego motywu w `src/index.css` jest generowany skryptem `scripts/gen-theme-css.py`; nowa klasa `rf-dark` przywraca ciemną paletę wewnątrz jasnego motywu.

## 1.4.0
- **Jasny motyw.** W Ustawieniach → „Motyw kolorystyczny” można wybrać wygląd Ciemny (domyślny) lub Jasny; zmiana działa od razu, bez restartu, także na ekranie logowania, a pasek tytułu okna (Windows/Linux) przyjmuje ten sam motyw. Wybór jest zapamiętywany na komputerze, podobnie jak język.
- Terminal SSH w jasnym motywie dostaje jasną paletę 16 kolorów (przełączaną na żywo, bez ponownego łączenia). Opcja „Ciemny terminal SSH w jasnym motywie” zostawia ciemny terminal przy jasnej reszcie aplikacji.
- Technicznie: jasny motyw przemapowuje paletę Tailwind (zmienne CSS `--color-*`) pod klasą `html.light` w `src/index.css`; kolory panelu połączeń i obszaru RDP są nazwanymi tokenami (`side-*`, `rdp-bg`) zamiast stałych `#hex`. Logika w `src/theme/`.
- SFTP: szersza kolumna czasu modyfikacji (pełna godzina bez obcinania).

## 1.3.1
- SFTP: kolumna „Zmodyfikowano” (data i godzina modyfikacji) jest widoczna zawsze, także gdy okno SFTP zajmuje połowę panelu – wcześniej pokazywała się tylko w szerokim panelu. Format skrócony (np. `23.10.26, 14:05`), pełna data z sekundami w podpowiedzi; sortowanie po kliknięciu nagłówka.

## 1.3.0
- **Własna ikona aplikacji** (znak zachęty terminala `>` i fala „flow” na kafelku w kolorach aplikacji) zamiast domyślnej ikony Tauri – w pasku zadań, pliku `.exe`, instalatorach i pakietach Linux. Ten sam znak jest logo w nagłówku i na ekranie logowania oraz ikoną karty w trybie przeglądarkowym. Źródło: `src-tauri/icons/icon.svg` (pozostałe rozmiary: `npx tauri icon`).
- SFTP: na początku listy plików jest wpis `..` prowadzący do katalogu nadrzędnego (dwuklik), tak jak w FileZilli i WinSCP – po obu stronach. Można też na niego upuścić pliki, aby skopiować je do katalogu nadrzędnego.

## 1.2.0
- **Katalogi startowe SFTP są właściwością połączenia.** W oknie SFTP przycisk „Zapamiętaj katalogi” (pinezka w nagłówku lub menu pod prawym przyciskiem) zapisuje bieżący katalog lokalny i katalog na serwerze dla tego połączenia; obok jest przycisk, który je zapomina. Oba katalogi można też wpisać w oknie edycji połączenia SSH („Katalogi startowe SFTP”). Bez konfiguracji SFTP otwiera katalog domowy na komputerze i katalog domowy użytkownika połączenia na serwerze; zapamiętany katalog, który już nie istnieje, również kończy się katalogiem domowym. Folder przypięty we wcześniejszych wersjach jest nadal używany jako katalog lokalny.
- Usunięto globalną opcję „Globalny katalog pobierania plików (SFTP)” z Ustawień i z okna połączenia. Dla połączeń RDP pozostaje własny „Folder wymiany plików (RDP)” (domyślnie systemowy folder Pobrane).
- Naprawiono ścieżki na serwerze w SFTP na Windows: po wejściu do podkatalogu ścieżka wyglądała jak `/etc\apport` (Windows łączył ścieżki znakiem `\`). Ścieżki zdalne zawsze używają `/`, także w komunikatach błędów.
- Wklejanie tekstu do terminala SSH zamienia windowsowe końce linii (CRLF) na pojedynczy Enter i używa trybu „bracketed paste”, jeśli program na serwerze go włączył (vim, nano, bash). Wcześniej tekst skopiowany na Windows wklejał się z dodatkowymi pustymi liniami.

## 1.1.3
- Naprawiono kompilację na Windows: logowanie kluczem SSH z pamięci używa bezpośrednio funkcji libssh2 (`libssh2_userauth_publickey_frommemory`), bo biblioteka `ssh2` udostępnia ją na Windows tylko z backendem OpenSSL. Zachowanie bez zmian względem 1.1.2.

## 1.1.2 – poprawki bezpieczeństwa
- **FreeRDP: hasło nie trafia już do linii poleceń.** Zamiast `/p:hasło` (widoczne dla każdego użytkownika przez `ps`, `top`, `/proc/<pid>/cmdline`) używane jest `/from-stdin:force`, a hasło jest przekazywane przez potok stdin. Sprawdzone z FreeRDP 2.11 i 3.32 na serwerze xrdp (logowanie udane, hasło nieobecne w `/proc/<pid>/cmdline`).
- **Uprawnienia plików sejfu na Linux/macOS:** `vault.json`, pliki tymczasowe zapisu i kopie zapasowe są tworzone z prawami `0600`, nowe katalogi (konfiguracja, `backups`) z `0700`. Istniejące pliki z luźniejszymi prawami (np. `0644`) są zawężane przy starcie i przy tworzeniu kopii.
- **Klucze SSH bez plików tymczasowych:** klucz z sejfu jest używany z pamięci na wszystkich systemach (na Windows WinCNG z crypt32), klucz wskazany jako plik na dysku jest czytany bezpośrednio przez libssh2 – bez kopii. Jedyny wyjątek: na Windows klucz PEM zabezpieczony hasłem (WinCNG nie odszyfruje go z pamięci) – wtedy powstaje krótkotrwały plik w prywatnym katalogu użytkownika (`%LOCALAPPDATA%\RemoteFlow\ssh-tmp`), nadpisywany zerami i usuwany zaraz po logowaniu; pozostałości po awarii (także stare pliki `rf_ssh_*.tmp` z `%TEMP%`) są usuwane przy starcie.
- **Usunięto komendę `read_local_text_file(path)`**, która pozwalała warstwie WWW odczytać dowolny plik. Klucz prywatny wybiera się teraz w oknie systemowym, a backend czyta wyłącznie wybrany plik i tylko jeśli wygląda na klucz prywatny (maks. 64 KB).

## 1.1.1
- Nowy wygląd wyboru języka: zamiast systemowej listy rozwijanej (jasnej na Windows) przycisk `PL`/`EN` w stylu nagłówka i ciemne menu jak pozostałe menu aplikacji; w Ustawieniach przełącznik dwuprzyciskowy Polski / English.

## 1.1.0
- Angielska wersja językowa interfejsu. Wybór języka (Polski / English) w nagłówku aplikacji, na ekranie logowania i w Ustawieniach; zmiana działa od razu, bez restartu i bez zamykania sesji. Wybór jest zapamiętywany, a przy pierwszym uruchomieniu ustawiany według języka systemu.
- Komunikaty backendu (błędy, statusy połączeń, okna systemowe) są również tłumaczone (`tr!` w `src-tauri/src/i18n.rs`, komenda `app_set_language`).
- Słownik tłumaczeń: `src/i18n/en.json` (kluczem jest tekst polski). Skrypt `node scripts/check-i18n.mjs` sprawdza, czy każdy tekst z `t('…')` ma tłumaczenie.

## 1.0.4
- Błąd połączenia RDP można zaznaczyć i skopiować (przycisk „Kopiuj treść błędu”).
- Kody odmowy logowania Windows (np. `STATUS_LOGON_FAILURE 0xc000006d`, zablokowane/wyłączone konto, wygasłe hasło, brak prawa do Pulpitu zdalnego) są wyjaśniane po polsku, razem z loginem wysłanym do serwera.
- Ekran łączenia i pobierany plik `.rdp` pokazują login z domeną (`DOMENA\użytkownik`).

## 1.0.3
- Poprawna obsługa domeny w połączeniach RDP. Login można podać jako `jan` + pole „Domena”, `DOMENA\jan`, `jan@domena.local` (UPN) lub `.\konto` (konto lokalne). Wcześniej wpisanie domeny jednocześnie w nazwie użytkownika i w polu „Domena” (typowe po imporcie z mRemoteNG) albo UPN z wypełnioną domeną kończyło się błędem „invalid username” w IronRDP.
- Ta sama normalizacja dla FreeRDP (`/u:` i `/d:`); dla `mstsc` login `DOMENA\użytkownik` jest podpowiadany w oknie logowania (tymczasowy plik .rdp bez hasła).
- Pole „Domena Windows” przeniesione obok nazwy użytkownika i hasła, z podglądem „Logowanie jako: …”.

## 1.0.2
- Przygotowanie do publikacji na GitHubie: opis aplikacji po angielsku (`README.md`) i polsku (`README.pl.md`), licencja MIT, zrzuty ekranu, metadane projektu (opis, autor, licencja, repozytorium) w `package.json`, `Cargo.toml` i `tauri.conf.json`.
- Usunięto nieużywane pliki: stara szuflada SFTP (`SftpDrawer.tsx`) wraz z obsługującymi ją komendami backendu, pliki z szablonu Tauri/Vite (`App.css`, `react.svg`, `vite.svg`, `tauri.svg`), nieaktualna `INSTRUKCJA_WINDOWS.md` (zastąpiona przez README), tymczasowe archiwum `_rf_tmp/` oraz niedziałające skrypty `build:windows` / `build:linux` z `package.json`.

## 1.0.1
- Wprowadzono wersjonowanie aplikacji. Numer wersji jest widoczny obok logo w nagłówku, na ekranie logowania i na ekranie blokady PIN.

## 1.0.0
- Wersja bazowa: sejf v2 (HMAC), PIN, TOFU dla SSH/RDP, RDP na Windows (fallback TLS dla starszych serwerów), schowek plików RDP, import haseł z mRemoteNG, kopie zapasowe sejfu, automatyczna blokada, nowa struktura połączeń, dwupanelowy menedżer SFTP z menu kontekstowym, potwierdzenia zamykania połączeń i programu (konfigurowalne), potwierdzenia usuwania przy elemencie.
