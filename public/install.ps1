# IDEA installer for Windows (S-52).
#   irm https://idea-ideallab.vercel.app/install.ps1 | iex
# Checks for Node.js 20+, installs the LTS via winget if it's missing,
# then starts IDEA (npx @ideallab/idea). Nothing else is touched.

$ErrorActionPreference = "Stop"

function Get-NodeMajor {
  try {
    $v = (& node --version) 2>$null
    if (-not $v) { return 0 }
    return [int]($v.ToString().TrimStart("v").Split(".")[0])
  } catch { return 0 }
}

if ((Get-NodeMajor) -lt 20) {
  Write-Host "Node.js 20+ was not found. Installing the LTS with winget..." -ForegroundColor Yellow
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if (-not $winget) {
    Write-Host ""
    Write-Host "winget is not available on this machine." -ForegroundColor Red
    Write-Host "Install Node.js from https://nodejs.org (standard download, default options),"
    Write-Host "then open a new terminal and run:  npx @ideallab/idea"
    return
  }
  winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements

  # This session's PATH predates the install — point at the default location.
  $nodeDir = Join-Path $env:ProgramFiles "nodejs"
  if (Test-Path (Join-Path $nodeDir "node.exe")) { $env:Path = "$nodeDir;$env:Path" }

  if ((Get-NodeMajor) -lt 20) {
    Write-Host ""
    Write-Host "Node.js is installed, but this terminal can't see it yet." -ForegroundColor Yellow
    Write-Host "Open a NEW terminal and run:  npx @ideallab/idea"
    return
  }
}

Write-Host ""
Write-Host "Starting IDEA - the first run builds once (a few minutes), then your browser opens." -ForegroundColor Green
npx --yes @ideallab/idea
