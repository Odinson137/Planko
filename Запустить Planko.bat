@echo off
chcp 65001 > nul
echo Запуск Planko CAD...

if exist "%~dp0release\Planko-win32-x64\Planko.exe" (
    start "" "%~dp0release\Planko-win32-x64\Planko.exe"
) else (
    echo Скомпилированный файл не найден, сборка и запуск...
    call npm run build:exe
    start "" "%~dp0release\Planko-win32-x64\Planko.exe"
)
