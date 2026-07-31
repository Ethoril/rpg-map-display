@echo off
rem ============================================================================
rem  Outil de preparation des cartes : double-cliquer ce fichier.
rem
rem  Demarre le serveur local et ouvre la page dans le navigateur. Un navigateur
rem  n'a pas le droit de lancer un processus sur la machine : ce fichier existe
rem  pour que cette contrainte ne coute pas un terminal au mainteneur.
rem
rem  Fermer cette fenetre arrete l'outil.
rem
rem  Pas d'accents dans ce fichier : la console Windows n'est pas en UTF-8 par
rem  defaut, et un message d'erreur illisible est pire que pas de message.
rem ============================================================================

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js est introuvable dans le PATH.
  echo   L'outil en depend : la preparation d'image tourne en Node, pas dans le navigateur.
  echo.
  echo   Installer Node.js 24 ou superieur, puis relancer ce fichier.
  echo.
  pause
  exit /b 1
)

echo Demarrage de l'outil de preparation des cartes...
echo.
node "scripts\prepare-server.mjs" %*

rem Le serveur ne rend la main qu'a l'arret. Une sortie immediate signale une
rem erreur que le mainteneur doit pouvoir lire avant que la fenetre disparaisse.
if errorlevel 1 (
  echo.
  echo   L'outil s'est arrete sur une erreur. Le message est au-dessus.
  echo.
  pause
)
