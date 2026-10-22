@echo off
chcp 65001 >nul
title RemoteFlow - Budowanie instalatora Windows (.exe)

echo ========================================================
echo         RemoteFlow - Budowanie wydania na Windows
echo ========================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [BLAD] Node.js nie zostal znaleziony w systemie!
    echo Pobierz i zainstaluj Node.js: https://nodejs.org/
    pause
    exit /b 1
)

where cargo >nul 2>nul
if %errorlevel% neq 0 (
    echo [BLAD] Rust nie zostal znaleziony!
    echo Pobierz i zainstaluj Rust: https://rustup.rs/
    pause
    exit /b 1
)

echo [*] Sprawdzanie i instalowanie zaleznosci Node.js...
call npm install
if %errorlevel% neq 0 (
    echo [BLAD] Blad podczas npm install!
    pause
    exit /b 1
)

echo.
echo [*] Budowanie pliku wykonywalnego oraz instalatora (Tauri Build)...
echo [*] Moze to potrwac kilka minut za pierwszym razem...
echo.

call npm run tauri build

if %errorlevel% neq 0 (
    echo.
    echo [BLAD] Kompilacja zakonczyla sie bledem.
    pause
    exit /b 1
)

echo.
echo ========================================================
echo  [SUKCES] Aplikacja zostala pomyslnie zbudowana!
echo ========================================================
echo.
echo Pliki wykonywalne i instalatory znajdziesz w:
echo   src-tauri\target\release\
echo   src-tauri\target\release\bundle\nsis\ (instalator .exe)
echo   src-tauri\target\release\bundle\msi\  (instalator .msi)
echo.
pause
