# make-icon.ps1 — draws the game icon (a blood-red casino chip with a skull)
# at several sizes and packs them into launcher\icon.ico (PNG-compressed ICO).
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function Draw-Chip([int]$S) {
  $bmp = New-Object System.Drawing.Bitmap $S, $S, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.InterpolationMode = 'HighQualityBicubic'
  $g.Clear([System.Drawing.Color]::Transparent)
  $f = $S / 256.0
  $rect = New-Object System.Drawing.RectangleF (6 * $f), (6 * $f), (244 * $f), (244 * $f)

  # chip body
  $body = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, ([System.Drawing.Color]::FromArgb(255, 200, 24, 44)), ([System.Drawing.Color]::FromArgb(255, 90, 6, 18)), 60
  $g.FillEllipse($body, $rect)
  # edge stripes (the classic chip "spots")
  $white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 245, 238, 220))
  $cx = 128 * $f; $cy = 128 * $f
  for ($i = 0; $i -lt 8; $i++) {
    $a = $i * [Math]::PI / 4
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddPie($rect.X, $rect.Y, $rect.Width, $rect.Height, [float]($i * 45 - 9), 18)
    $g.FillPath($white, $path)
  }
  # inner ring + inlay
  $inner = New-Object System.Drawing.RectangleF (46 * $f), (46 * $f), (164 * $f), (164 * $f)
  $g.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 30, 8, 14))), $inner)
  $gold = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 222, 180, 60)), ([float](7 * $f))
  $g.DrawEllipse($gold, $inner)

  # skull
  $bone = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 236, 228, 205))
  $dark = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 30, 8, 14))
  $g.FillEllipse($bone, (New-Object System.Drawing.RectangleF (84 * $f), (66 * $f), (88 * $f), (84 * $f)))
  $g.FillRectangle($bone, (New-Object System.Drawing.RectangleF (100 * $f), (132 * $f), (56 * $f), (40 * $f)))
  $g.FillEllipse($dark, (New-Object System.Drawing.RectangleF (98 * $f), (100 * $f), (24 * $f), (26 * $f)))
  $g.FillEllipse($dark, (New-Object System.Drawing.RectangleF (134 * $f), (100 * $f), (24 * $f), (26 * $f)))
  $nose = New-Object System.Drawing.Drawing2D.GraphicsPath
  $nose.AddPolygon([System.Drawing.PointF[]]@(
    (New-Object System.Drawing.PointF (128 * $f), (128 * $f)),
    (New-Object System.Drawing.PointF (121 * $f), (142 * $f)),
    (New-Object System.Drawing.PointF (135 * $f), (142 * $f))))
  $g.FillPath($dark, $nose)
  $tooth = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 30, 8, 14)), ([float](4 * $f))
  foreach ($x in 114, 128, 142) { $g.DrawLine($tooth, [float]($x * $f), [float](152 * $f), [float]($x * $f), [float](172 * $f)) }
  # glowing eyes
  $glow = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 120, 255, 120))
  $g.FillEllipse($glow, (New-Object System.Drawing.RectangleF (106 * $f), (108 * $f), (9 * $f), (9 * $f)))
  $g.FillEllipse($glow, (New-Object System.Drawing.RectangleF (142 * $f), (108 * $f), (9 * $f), (9 * $f)))
  $g.Dispose()
  return $bmp
}

$sizes = 256, 64, 48, 32, 16
$pngs = @()
foreach ($s in $sizes) {
  $bmp = Draw-Chip $s
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $pngs += ,($ms.ToArray())
  $bmp.Dispose()
}

$out = Join-Path $PSScriptRoot 'icon.ico'
$fs = [System.IO.File]::Create($out)
$bw = New-Object System.IO.BinaryWriter $fs
$bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $s = $sizes[$i]
  $bw.Write([byte]($(if ($s -ge 256) { 0 } else { $s })))
  $bw.Write([byte]($(if ($s -ge 256) { 0 } else { $s })))
  $bw.Write([byte]0); $bw.Write([byte]0)
  $bw.Write([UInt16]1); $bw.Write([UInt16]32)
  $bw.Write([UInt32]$pngs[$i].Length); $bw.Write([UInt32]$offset)
  $offset += $pngs[$i].Length
}
foreach ($p in $pngs) { $bw.Write($p) }
$bw.Close()
Write-Host "icon written: $out"
