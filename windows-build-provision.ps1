$ErrorActionPreference = 'Continue'
New-Item -ItemType Directory -Force -Path C:\Provision | Out-Null
$log = "S:\WINDOWS_BUILD_LOG.txt"
function Log($msg) {
    $line = "$(Get-Date -Format o)  $msg"
    Add-Content -Path $log -Value $line -Encoding utf8
    Write-Output $line
}
"" | Out-File -FilePath $log -Force -Encoding utf8

Log "=== Sojourner Windows build: provisioning started ==="

# 1. Wait for winget to be available
$wingetCmd = $null
for ($i = 0; $i -lt 30; $i++) {
    $wingetCmd = Get-Command winget -ErrorAction SilentlyContinue
    if ($wingetCmd) { break }
    Start-Sleep -Seconds 5
}
if (-not $wingetCmd) {
    Log "ERROR: winget not available after waiting -- aborting toolchain install"
    "FAILED: winget unavailable" | Out-File "S:\WINDOWS_BUILD_DONE.txt" -Force -ErrorAction SilentlyContinue
    exit 1
}

# 2. Install toolchain
Log "Installing Rust (rustup)"
winget install --id Rustlang.Rustup -e --silent --accept-package-agreements --accept-source-agreements 2>&1 | ForEach-Object { Log $_ }

Log "Installing WinLibs MinGW-w64 GCC (standalone, no MSYS2 shell needed)"
winget install --id BrechtSanders.WinLibs.POSIX.UCRT -e --silent --accept-package-agreements --accept-source-agreements 2>&1 | ForEach-Object { Log $_ }

Log "Installing Node.js LTS"
winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements 2>&1 | ForEach-Object { Log $_ }

Log "Installing Git"
winget install --id Git.Git -e --silent --accept-package-agreements --accept-source-agreements 2>&1 | ForEach-Object { Log $_ }

# Refresh PATH in this process from machine + user env
$machinePath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
$userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
$env:Path = "$machinePath;$userPath;${env:USERPROFILE}\.cargo\bin"

# Find WinLibs' gcc.exe (winget "portable" packages nest deep under LOCALAPPDATA) and add its dir to PATH
$gccExe = Get-ChildItem -Path "$env:LOCALAPPDATA\Microsoft\WinGet\Packages","C:\Program Files","C:\ProgramData" -Filter "gcc.exe" -Recurse -ErrorAction SilentlyContinue -Depth 10 | Select-Object -First 1
if ($gccExe) {
    Log "Found gcc.exe at $($gccExe.FullName)"
    $env:Path = "$($gccExe.DirectoryName);$env:Path"
} else {
    Log "WARNING: gcc.exe not found after WinLibs install"
}

if (Test-Path "${env:USERPROFILE}\.cargo\bin\rustup.exe") {
    Log "Setting rustup default-host to x86_64-pc-windows-gnu"
    & "${env:USERPROFILE}\.cargo\bin\rustup.exe" set default-host x86_64-pc-windows-gnu 2>&1 | ForEach-Object { Log $_ }
    Log "Installing pinned-version GNU toolchain (matches rust-toolchain.toml)"
    & "${env:USERPROFILE}\.cargo\bin\rustup.exe" toolchain install 1.94.1-x86_64-pc-windows-gnu 2>&1 | ForEach-Object { Log $_ }
} else {
    Log "WARNING: rustup.exe not found after install"
}

# 3. Symlink Minecraft saves to the Z: shared folder (host ~/.minecraft/saves)
Log "Linking Minecraft saves folder to Z:\"
New-Item -ItemType Directory -Force -Path "${env:APPDATA}\.minecraft" | Out-Null
if (Test-Path "${env:APPDATA}\.minecraft\saves") {
    Remove-Item "${env:APPDATA}\.minecraft\saves" -Recurse -Force -ErrorAction SilentlyContinue
}
cmd /c mklink /D "${env:APPDATA}\.minecraft\saves" "Z:\" 2>&1 | ForEach-Object { Log $_ }

# 4. Build directly against the S: shared folder -- no local copy, no sync ambiguity
Set-Location S:\

Log "Running npm install"
& npm install 2>&1 | ForEach-Object { Log $_ }

Log "Running npm run build"
& npm run build 2>&1 | ForEach-Object { Log $_ }

# 5. Smoke test -- launch the raw release binary and confirm it stays up
$exe = "S:\src-tauri\target\release\Sojourner.exe"
$smokeResult = "UNKNOWN"
if (Test-Path $exe) {
    Log "Smoke-testing $exe"
    $p = Start-Process -FilePath $exe -PassThru
    Start-Sleep -Seconds 15
    if ($p.HasExited) {
        $smokeResult = "FAILED (exited early, code $($p.ExitCode))"
        Log "SMOKE TEST FAILED: process exited early with code $($p.ExitCode)"
    } else {
        $smokeResult = "OK (running after 15s)"
        Log "SMOKE TEST OK: process still running after 15s (PID $($p.Id))"
        Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    }
} else {
    $smokeResult = "FAILED (exe not found)"
    Log "ERROR: built exe not found at $exe"
}

Log "=== Provisioning finished. Smoke test: $smokeResult ==="
"DONE: smoke test = $smokeResult" | Out-File "S:\WINDOWS_BUILD_DONE.txt" -Force -ErrorAction SilentlyContinue
