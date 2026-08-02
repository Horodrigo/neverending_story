$ErrorActionPreference = "Stop"

$InstallRoot = Join-Path $env:LOCALAPPDATA "NeverendingFantasyMapStudioHost"
$SourceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\\..")).Path

Write-Host "Instalando Neverending Fantasy Map Studio Host em $InstallRoot"

if (-not (Test-Path $InstallRoot)) {
  New-Item -ItemType Directory -Path $InstallRoot | Out-Null
}

robocopy $SourceRoot $InstallRoot /E /XD ".git" "node_modules" "dist" > $null

Push-Location $InstallRoot
try {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js não encontrado. Instale o Node.js 20+ e execute novamente."
  }

  npm install
  npm run build

  $runScript = @"
Set-Location "$InstallRoot"
npm run host
"@
  $runScriptPath = Join-Path $InstallRoot "Run-Neverending-Host.ps1"
  Set-Content -Path $runScriptPath -Value $runScript -Encoding UTF8

  $desktop = [Environment]::GetFolderPath("Desktop")
  $shortcutPath = Join-Path $desktop "Neverending Map Studio Host.lnk"
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = "powershell.exe"
  $shortcut.Arguments = "-ExecutionPolicy Bypass -File `"$runScriptPath`""
  $shortcut.WorkingDirectory = $InstallRoot
  $shortcut.IconLocation = "powershell.exe,0"
  $shortcut.Save()

  Write-Host "Instalação concluída. Use o atalho na Área de Trabalho: Neverending Map Studio Host"
}
finally {
  Pop-Location
}
