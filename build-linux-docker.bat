@echo off
chcp 65001 >nul
title RemoteFlow - Budowanie wersji Linux w Dockerze
cd /d "%~dp0"

where docker >nul 2>nul
if %errorlevel% neq 0 (
    echo [BLAD] Nie znaleziono Dockera. Zainstaluj Docker Desktop: https://www.docker.com/products/docker-desktop/
    pause
    exit /b 1
)

docker info >nul 2>nul
if %errorlevel% neq 0 (
    echo [BLAD] Docker nie dziala. Uruchom Docker Desktop i sprobuj ponownie.
    pause
    exit /b 1
)

echo Budowanie wersji Linux (pierwsze uruchomienie trwa 10-20 minut)...
set DOCKER_BUILDKIT=1
docker build -f docker/Dockerfile.linux --target export --output type=local,dest=dist-linux .
if %errorlevel% neq 0 (
    echo.
    echo [BLAD] Budowanie zakonczylo sie bledem.
    pause
    exit /b 1
)

echo.
echo Gotowe. Pliki znajduja sie w folderze dist-linux:
dir /b dist-linux
pause
