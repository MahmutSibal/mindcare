# Kurulum sihirbazı görselleri (BMP). Kullanım: powershell -File scripts/make-installer-art.ps1
# Çıktı: src-tauri/installer/{guide-tr,guide-en,sidebar,header}.bmp  (metinler scripts/installer-art.json)
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root "src-tauri\installer"
New-Item -ItemType Directory -Force $out | Out-Null
$texts = Get-Content (Join-Path $PSScriptRoot "installer-art.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$logo = [System.Drawing.Image]::FromFile((Join-Path $root "logo\mavi-ruh-simge-1024.png"))

function C($hex) { [System.Drawing.ColorTranslator]::FromHtml($hex) }
$BG = C "#0f1b1d"; $PANEL = C "#152629"; $CARD = C "#1c3135"; $ACCENT = C "#4fb3a5"; $INK = C "#e6f0ee"; $MUTED = C "#9bb3b0"

function New-Canvas($w, $h) {
  $bmp = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = "AntiAlias"; $g.InterpolationMode = "HighQualityBicubic"; $g.TextRenderingHint = "AntiAliasGridFit"
  return @{ bmp = $bmp; g = $g }
}
function RoundRect($g, $brush, $x, $y, $w, $h, $r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $p.AddArc($x, $y, $r, $r, 180, 90); $p.AddArc($x + $w - $r, $y, $r, $r, 270, 90)
  $p.AddArc($x + $w - $r, $y + $h - $r, $r, $r, 0, 90); $p.AddArc($x, $y + $h - $r, $r, $r, 90, 90); $p.CloseFigure()
  $g.FillPath($brush, $p)
}
function Save($c, $name) { $c.g.Dispose(); $c.bmp.Save((Join-Path $out $name), [System.Drawing.Imaging.ImageFormat]::Bmp); $c.bmp.Dispose() }

# --- Adım simgeleri (basit çizimler) -------------------------------------------------
function Icon($g, $i, $cx, $cy) {
  $pen = New-Object System.Drawing.Pen $INK, 2; $pen.StartCap = "Round"; $pen.EndCap = "Round"; $pen.LineJoin = "Round"
  switch ($i) {
    0 { $g.DrawEllipse($pen, $cx - 5, $cy - 9, 10, 10); $g.DrawArc($pen, $cx - 10, $cy + 1, 20, 14, 180, 180); $g.DrawLine($pen, $cx + 11, $cy - 6, $cx + 11, $cy + 2); $g.DrawLine($pen, $cx + 7, $cy - 2, $cx + 15, $cy - 2) }
    1 { $g.DrawRectangle($pen, $cx - 12, $cy - 8, 17, 16); $g.DrawLine($pen, $cx + 5, $cy - 2, $cx + 13, $cy - 7); $g.DrawLine($pen, $cx + 13, $cy - 7, $cx + 13, $cy + 7); $g.DrawLine($pen, $cx + 13, $cy + 7, $cx + 5, $cy + 2) }
    2 { $g.DrawRectangle($pen, $cx - 9, $cy - 11, 18, 22); $g.DrawLine($pen, $cx - 5, $cy - 5, $cx + 5, $cy - 5); $g.DrawLine($pen, $cx - 5, $cy, $cx + 5, $cy); $g.DrawLine($pen, $cx - 5, $cy + 5, $cx + 1, $cy + 5) }
    3 { $g.DrawLine($pen, $cx, $cy - 11, $cx + 10, $cy - 7); $g.DrawLine($pen, $cx + 10, $cy - 7, $cx + 10, $cy + 2); $g.DrawArc($pen, $cx - 10, $cy - 2, 20, 14, 0, 180); $g.DrawLine($pen, $cx - 10, $cy + 2, $cx - 10, $cy - 7); $g.DrawLine($pen, $cx - 10, $cy - 7, $cx, $cy - 11); $g.DrawLine($pen, $cx - 4, $cy, $cx - 1, $cy + 3); $g.DrawLine($pen, $cx - 1, $cy + 3, $cx + 4, $cy - 3) }
  }
  $pen.Dispose()
}

# --- Rehber sayfası (iki dil) --------------------------------------------------------
foreach ($lang in @("tr", "en")) {
  $t = $texts.$lang
  $w = 500; $h = 255
  $c = New-Canvas $w $h; $g = $c.g
  $g.Clear($BG)
  $fTitle = New-Object System.Drawing.Font "Segoe UI Semibold", 13
  $fH = New-Object System.Drawing.Font "Segoe UI Semibold", 10.5
  $fP = New-Object System.Drawing.Font "Segoe UI", 9
  $bInk = New-Object System.Drawing.SolidBrush $INK; $bMuted = New-Object System.Drawing.SolidBrush $MUTED
  $bCard = New-Object System.Drawing.SolidBrush $CARD; $bAccent = New-Object System.Drawing.SolidBrush $ACCENT; $bPanel = New-Object System.Drawing.SolidBrush $PANEL
  $g.DrawString($t.title, $fTitle, $bInk, 8, 2)
  $y = 32
  for ($i = 0; $i -lt 4; $i++) {
    RoundRect $g $bPanel 0 $y ($w - 2) 44 12
    $g.FillEllipse($bAccent, 8, $y + 5, 34, 34)
    Icon $g $i 25 ($y + 22)
    $g.DrawString("$($i + 1). " + $t.steps[$i][0], $fH, $bInk, 54, $y + 4)
    $g.DrawString($t.steps[$i][1], $fP, $bMuted, 54, $y + 23)
    $y += 48
  }
  $g.DrawString($t.footer, $fP, $bMuted, 8, $y + 2)
  Save $c "guide-$lang.bmp"
}

# --- Karşılama kenar görseli 164x314 ------------------------------------------------
$c = New-Canvas 164 314; $g = $c.g
$grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.Rectangle 0, 0, 164, 314), (C "#173b38"), $BG, 90
$g.FillRectangle($grad, 0, 0, 164, 314)
$g.DrawImage($logo, 32, 56, 100, 100)
$f1 = New-Object System.Drawing.Font "Segoe UI Semibold", 15
$f2 = New-Object System.Drawing.Font "Segoe UI", 8.5
$sf = New-Object System.Drawing.StringFormat; $sf.Alignment = "Center"
$g.DrawString("Mavi Ruh", $f1, (New-Object System.Drawing.SolidBrush $INK), (New-Object System.Drawing.RectangleF 0, 168, 164, 28), $sf)
$g.DrawString($texts.tr.footer, $f2, (New-Object System.Drawing.SolidBrush $MUTED), (New-Object System.Drawing.RectangleF 10, 262, 144, 40), $sf)
Save $c "sidebar.bmp"

# --- Üst başlık görseli 150x57 -------------------------------------------------------
$c = New-Canvas 150 57; $g = $c.g
$g.Clear($BG)
$g.DrawImage($logo, 8, 7, 42, 42)
$g.DrawString("Mavi Ruh", (New-Object System.Drawing.Font "Segoe UI Semibold", 12), (New-Object System.Drawing.SolidBrush $INK), 56, 16)
Save $c "header.bmp"
$logo.Dispose()
Write-Host "Kurulum görselleri yazıldı: $out"
