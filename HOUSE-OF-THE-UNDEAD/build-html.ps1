# build-html.ps1 — packs the whole game into ONE .html file you can send to
# anyone. They double-click it and it opens in Edge/Chrome: no install, no
# server, and no .exe for Windows SmartScreen / Smart App Control to block.
#
#   powershell -ExecutionPolicy Bypass -File build-html.ps1
#
# How: the stylesheet is inlined; every ES module (three.js + src/**) is
# embedded as an inert <script type="hotu/module">. At startup a tiny loader
# turns each into a blob: URL and installs an import map pointing the bare
# specifiers "three" and "@hotu/src/..." at them, then imports main.js.

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$out = Join-Path (Split-Path $root -Parent) 'HOUSE OF THE UNDEAD.html'
$utf8 = New-Object System.Text.UTF8Encoding($false)
function ReadText($p) { [IO.File]::ReadAllText($p, [Text.Encoding]::UTF8) }

# never let embedded source close the tag early
function Safe($t) { $t -replace '</(script)', '<\/$1' }

$modules = [ordered]@{}
$modules['three'] = Join-Path $root 'vendor\three.module.js'
Get-ChildItem (Join-Path $root 'src') -Recurse -Filter *.js | ForEach-Object {
  $rel = $_.FullName.Substring($root.Length + 1).Replace('\', '/')
  $modules["@hotu/$rel"] = $_.FullName
}

$sb = New-Object Text.StringBuilder
foreach ($key in $modules.Keys) {
  $path = $modules[$key]
  $src = ReadText $path
  if ($key -ne 'three') {
    $dir = Split-Path $path -Parent
    # rewrite relative imports to their bare "@hotu/..." key
    $src = [regex]::Replace($src, "(\bfrom\s*|\bimport\s*)(['""])(\.{1,2}/[^'""]+)\2", {
      param($m)
      $full = [IO.Path]::GetFullPath((Join-Path $dir $m.Groups[3].Value))
      $rel = $full.Substring($root.Length + 1).Replace('\', '/')
      return $m.Groups[1].Value + $m.Groups[2].Value + '@hotu/' + $rel + $m.Groups[2].Value
    })
  }
  [void]$sb.Append("<script type=""hotu/module"" data-key=""$key"">")
  [void]$sb.Append((Safe $src))
  [void]$sb.Append("</script>`n")
}

$loader = @'
<script>
(function () {
  var map = { imports: {} };
  document.querySelectorAll('script[type="hotu/module"]').forEach(function (s) {
    map.imports[s.dataset.key] = URL.createObjectURL(new Blob([s.textContent], { type: 'text/javascript' }));
  });
  var im = document.createElement('script');
  im.type = 'importmap';
  im.textContent = JSON.stringify(map);
  document.head.appendChild(im);
  var m = document.createElement('script');
  m.type = 'module';
  m.textContent = 'import "@hotu/src/main.js";';
  document.body.appendChild(m);
})();
</script>
'@

$html = ReadText (Join-Path $root 'index.html')
$css = ReadText (Join-Path $root 'styles\main.css')
$html = $html.Replace('<link rel="stylesheet" href="styles/main.css">', "<style>`n$css`n</style>")
$html = [regex]::Replace($html, '<script type="importmap">[\s\S]*?</script>\s*', '')
$peer = Safe (ReadText (Join-Path $root 'vendor\peerjs.min.js'))
$html = $html.Replace('<script src="vendor/peerjs.min.js"></script>', "<script>`n$peer`n</script>")
$html = $html.Replace('<script type="module" src="src/main.js"></script>', $sb.ToString() + $loader)
if ($html -match 'src="src/main.js"' -or $html -match 'href="styles/' -or $html -match 'src="vendor/') { throw 'index.html layout changed: loader not injected' }

[IO.File]::WriteAllText($out, $html, $utf8)
$mb = [math]::Round((Get-Item $out).Length / 1MB, 1)
Write-Host "built: $out ($mb MB, $($modules.Count) modules)"
