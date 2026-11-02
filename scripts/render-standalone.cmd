@echo off
REM ============================================================
REM Linvis AI Studio - 独立命令行渲染
REM
REM 此脚本完全不依赖 Cindy / Codex / DSH。
REM 不读取任何 Agent 会话状态，只读 projects\<id>\project.json。
REM
REM 用法:  scripts\render-standalone.cmd EP01-LLM-Harness
REM       或设 LINVIS_PROJECT 环境变量后直接运行
REM ============================================================
setlocal

set "PROJECT_ID=%~1"
if defined LINVIS_PROJECT if not defined PROJECT_ID set "PROJECT_ID=%LINVIS_PROJECT%"
if not defined PROJECT_ID set "PROJECT_ID=EP01-LLM-Harness"

REM 清理所有可能指向 Agent 平台的变量，证明引擎不依赖它们
set "CINDY_HOME="
set "CODEX_HOME="
set "ANTHROPIC_API_KEY="
set "OPENAI_API_KEY="
set "DSH_HOME="
set "PI_HOME="
set "CLAUDECODE="

pushd "%~dp0.."

echo ============================================================
echo  Linvis standalone render: %PROJECT_ID%
echo  CWD: %CD%
echo  Cindy/Codex/DSH env vars cleared
echo ============================================================
echo.

echo [1/4] Environment check
node engine\bin\linvis.mjs doctor >nul 2>&1
if errorlevel 1 (
  echo ERROR: environment check failed.
  node engine\bin\linvis.mjs doctor
  popd
  exit /b 1
)
echo   OK

echo.
echo [2/4] Regenerate audio from recipe
node engine\bin\linvis.mjs audio %PROJECT_ID% --force
if errorlevel 1 ( popd & exit /b 1 )

echo.
echo [3/4] Render video
node engine\bin\linvis.mjs render %PROJECT_ID% --force
if errorlevel 1 ( popd & exit /b 1 )

echo.
echo [4/4] Quality inspection
node engine\bin\linvis.mjs inspect %PROJECT_ID%
if errorlevel 1 ( popd & exit /b 1 )

echo.
echo ============================================================
echo  DONE - no Agent platform was launched.
echo  Output: out\render\%PROJECT_ID%-final.mp4
echo ============================================================
popd
endlocal
