@echo off
rem yiioffice launcher for the packaged Windows app: <install>\resources\cli\yiioffice.cmd
setlocal
set ELECTRON_RUN_AS_NODE=1
"%~dp0..\..\YiiOffice.exe" "%~dp0yiioffice.cjs" %*
endlocal
