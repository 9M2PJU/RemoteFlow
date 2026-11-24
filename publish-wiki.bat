@echo off
chcp 65001 >nul
setlocal
title RemoteFlow - Publikacja wiki

rem Publishes the pages from the wiki\ folder to the GitHub wiki (separate repository RemoteFlow.wiki.git).
rem Usage: publish-wiki.bat ["commit message"]
rem Before the first run: enable Wikis in the repository settings and create any first page on the Wiki tab.

cd /d "%~dp0"
set "WIKI_DIR=%~dp0..\remoteflow-wiki"
set "MSG=%~1"
if "%MSG%"=="" set "MSG=Update wiki"

if not exist "%WIKI_DIR%\.git" (
    echo Klonowanie repozytorium wiki do %WIKI_DIR% ...
    git clone https://github.com/jacek-nikiel/RemoteFlow.wiki.git "%WIKI_DIR%"
    if errorlevel 1 goto :fail
    git -C "%WIKI_DIR%" config user.name "Jacek Nikiel"
    git -C "%WIKI_DIR%" config user.email "123214505+jacek-nikiel@users.noreply.github.com"
)

git -C "%WIKI_DIR%" pull --ff-only
if errorlevel 1 goto :fail

copy /Y "wiki\*.md" "%WIKI_DIR%\" >nul
if errorlevel 1 goto :fail

git -C "%WIKI_DIR%" add -A
git -C "%WIKI_DIR%" diff --cached --quiet
if not errorlevel 1 (
    echo Wiki jest aktualne - brak zmian do wyslania.
    goto :end
)

git -C "%WIKI_DIR%" status --short
git -C "%WIKI_DIR%" commit -q -m "%MSG%"
if errorlevel 1 goto :fail
git -C "%WIKI_DIR%" push
if errorlevel 1 goto :fail
echo.
echo [OK] Wiki opublikowane: https://github.com/jacek-nikiel/RemoteFlow/wiki
goto :end

:fail
echo.
echo [BLAD] Publikacja wiki nie powiodla sie.
echo Jesli to pierwsza publikacja: GitHub - Settings - Features - wlacz Wikis,
echo potem zakladka Wiki - "Create the first page" - Save, i uruchom skrypt ponownie.
pause
exit /b 1

:end
endlocal
