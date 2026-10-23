# Historia zmian – RemoteFlow

Numer wersji: `MAJOR.MINOR.PATCH`. Każda zmiana podnosi co najmniej numer PATCH.
Wersja jest zapisana w trzech plikach, które muszą być zgodne (pilnuje tego test `version_tests` w `src-tauri/src/lib.rs`):
`package.json` (wyświetlana w aplikacji), `src-tauri/tauri.conf.json` (instalator) i `src-tauri/Cargo.toml`.

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
