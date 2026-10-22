@echo off
chcp 65001 >nul
title RemoteFlow - Uruchamianie na Windows (Dev Mode)

echo ========================================================
echo         RemoteFlow - Klient SSH & RDP dla Windows
echo ========================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [BLAD] Node.js nie zostal znaleziony w systemie!
    echo Zainstaluj Node.js ze strony: https://nodejs.org/ (wersja LTS)
    pause
    exit /b 1
)

where cargo >nul 2>nul
if %errorlevel% neq 0 (
    echo [BLAD] Rust (cargo) nie zostal znaleziony w systemie!
    echo Zainstaluj Rust ze strony: https://rustup.rs/
    echo Pamietaj o wybraniu "Visual Studio C++ Build Tools" podczas instalacji.
    pause
    exit /b 1
)

if not exist "node_modules\" (
    echo [*] Instalowanie zaleznosci Node.js (npm install)...
    call npm install
    if %errorlevel% neq 0 (
        echo [BLAD] Blad podczas npm install!
        pause
        exit /b 1
    )
)

echo.
echo [*] Uruchamianie aplikacji RemoteFlow w trybie deweloperskim...
echo [*] Kompilowanie frontendu (Vite) oraz backendu Rust (Tauri v2)...
echo.

call npm run tauri dev

if %errorlevel% neq 0 (
    echo.
    echo [BLAD] Wystapil problem podczas uruchamiania aplikacji.
    pause
)
