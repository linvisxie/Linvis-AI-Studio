param(
  [string]$Out = "D:\Linvis-AI-Studio\out\jy-test\lowshot.jpg",
  [int]$Width = 900,
  [int]$Quality = 72
)
# 低成本截图：JPEG + 缩小，避免把大 PNG 塞进会话上下文
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$sig = @'
using System;
using System.Runtime.InteropServices;
public class W32S {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
}
'@
if (-not ('W32S' -as [type])) { Add-Type -TypeDefinition $sig }

$p = Get-Process -Name JianyingPro -ErrorAction SilentlyContinue |
     Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($p) {
  [void][W32S]::ShowWindow($p.MainWindowHandle, 9)
  Start-Sleep -Milliseconds 400
  [void][W32S]::SetForegroundWindow($p.MainWindowHandle)
  Start-Sleep -Milliseconds 700
}

$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.X, $b.Y, 0, 0, $bmp.Size)

$h = [int]($b.Height * $Width / $b.Width)
$small = New-Object System.Drawing.Bitmap $Width, $h
$g2 = [System.Drawing.Graphics]::FromImage($small)
$g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g2.DrawImage($bmp, 0, 0, $Width, $h)

$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
         Where-Object { $_.MimeType -eq 'image/jpeg' }
$ep = New-Object System.Drawing.Imaging.EncoderParameters 1
$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter (
  [System.Drawing.Imaging.Encoder]::Quality), $Quality
$small.Save($Out, $codec, $ep)

$g.Dispose(); $g2.Dispose(); $small.Dispose(); $bmp.Dispose()
Write-Output ("saved {0} ({1} KB)" -f $Out, [int]((Get-Item $Out).Length / 1KB))
