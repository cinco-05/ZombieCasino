# build-exe.ps1 — packs the game into ONE double-clickable Windows exe.
#
#   powershell -ExecutionPolicy Bypass -File build-exe.ps1
#
# Output: ..\HOUSE OF THE UNDEAD.exe (next to this project folder).
# Uses only what ships with Windows: the .NET Framework C# compiler, plus the
# WebView2 SDK DLLs in launcher\lib (embedded into the exe).
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$launcher = Join-Path $root 'launcher'
$outExe = Join-Path (Split-Path $root -Parent) 'HOUSE OF THE UNDEAD.exe'
$work = Join-Path $env:TEMP 'hotu-build'
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'

if (Test-Path $work) { Remove-Item -Recurse -Force $work }
New-Item -ItemType Directory -Force $work | Out-Null

# ---- 1. the game payload: only what the page actually loads ----
$include = @('index.html', 'styles', 'src', 'vendor')
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$zipPath = Join-Path $work 'game.zip'
$fs = [System.IO.File]::Open($zipPath, 'Create')
$zip = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)
$count = 0
foreach ($item in $include) {
  $full = Join-Path $root $item
  $files = if (Test-Path $full -PathType Container) { Get-ChildItem $full -Recurse -File } else { Get-Item $full }
  foreach ($f in $files) {
    $rel = $f.FullName.Substring($root.Length + 1).Replace('\', '/')
    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $f.FullName, $rel, [System.IO.Compression.CompressionLevel]::Optimal)
    $count++
  }
}
$zip.Dispose(); $fs.Dispose()
Write-Host "packed $count game files"

# ---- 2. build stamp (a new stamp makes the exe unpack fresh files) ----
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
Set-Content -Path (Join-Path $work 'build.txt') -Value $stamp -Encoding ASCII -NoNewline

# ---- 3. icon ----
$icon = Join-Path $launcher 'icon.ico'
if (-not (Test-Path $icon)) { & (Join-Path $launcher 'make-icon.ps1') }

# ---- 4. compile ----
$lib = Join-Path $launcher 'lib'
$cscArgs = @(
  '/nologo', '/target:winexe', '/platform:x64', '/optimize+',
  "/out:$outExe",
  "/win32icon:$icon",
  "/reference:$lib\Microsoft.Web.WebView2.Core.dll",
  "/reference:$lib\Microsoft.Web.WebView2.WinForms.dll",
  '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll',
  '/reference:System.IO.Compression.dll', '/reference:System.IO.Compression.FileSystem.dll',
  "/resource:$zipPath,game.zip",
  "/resource:$work\build.txt,build.txt",
  "/resource:$lib\Microsoft.Web.WebView2.Core.dll,lib.Microsoft.Web.WebView2.Core.dll",
  "/resource:$lib\Microsoft.Web.WebView2.WinForms.dll,lib.Microsoft.Web.WebView2.WinForms.dll",
  "/resource:$lib\WebView2Loader.dll,WebView2Loader.dll",
  (Join-Path $launcher 'Launcher.cs')
)
& $csc @cscArgs
if ($LASTEXITCODE -ne 0) { throw "compile failed ($LASTEXITCODE)" }

$size = [Math]::Round((Get-Item $outExe).Length / 1MB, 1)
Write-Host "built: $outExe ($size MB, build $stamp)"
