# One-click Agent Notch install for Windows (user-level, no admin).
# From a clone:  .\install.ps1   (or double-click install.bat)
# From the web:  irm https://raw.githubusercontent.com/adityarya24/agent-notch/main/install.ps1 | iex

$ErrorActionPreference = 'Stop'
$RepoUrl = 'https://github.com/adityarya24/agent-notch.git'
$DefaultDest = Join-Path $env:USERPROFILE 'tools\agent-notch'

function Need-Command($name, $hint) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "Missing $name. $hint"
  }
}

Need-Command node 'Install Node.js 18+ from https://nodejs.org/ then run this again.'
Need-Command npm 'Install Node.js 18+ from https://nodejs.org/ then run this again.'

if ($PSScriptRoot) {
  $root = $PSScriptRoot
} else {
  Need-Command git 'Install Git from https://git-scm.com/ then run this again.'
  if (-not (Test-Path (Join-Path $DefaultDest 'package.json'))) {
    $parent = Split-Path $DefaultDest
    if (-not (Test-Path $parent)) {
      New-Item -ItemType Directory -Force -Path $parent | Out-Null
    }
    Write-Host "Cloning Agent Notch into $DefaultDest ..."
    git clone $RepoUrl $DefaultDest
  } else {
    Write-Host "Updating $DefaultDest ..."
    git -C $DefaultDest pull --ff-only
  }
  $root = $DefaultDest
}

Set-Location $root

Write-Host "Installing dependencies..."
if (Test-Path 'package-lock.json') {
  npm ci
} else {
  npm install
}

Write-Host "Building HUD..."
npm run build

Write-Host "Installing global 'notch' command (npm i -g .)..."
npm install -g .

if ((Test-Path '.env.example') -and -not (Test-Path '.env')) {
  Copy-Item '.env.example' '.env'
  Write-Host "Wrote .env from .env.example (gitignored). Fill Antigravity keys only if Gemini token refresh is needed."
}

Write-Host "Adding Windows Startup + launching HUD..."
node bin/cli.js autostart
node bin/cli.js restart

Write-Host ""
Write-Host "Agent Notch is installed."
Write-Host "  Toggle: Ctrl+Shift+U"
Write-Host "  CLI:    notch | notch stop | notch status"
Write-Host ""
Write-Host "Antigravity token refresh (optional): edit .env and set"
Write-Host "MINDSYNC_ANTIGRAVITY_CLIENT_ID / MINDSYNC_ANTIGRAVITY_CLIENT_SECRET"
Write-Host "Do not commit .env."
