<#
  jy-click.ps1 - Click inside the JianyingPro window using relative coordinates.

  Why not UI Automation:
    JianyingPro's main UI is CEF/Chromium rendered. The UIA tree returns 0
    elements, so there is no way to locate controls by name. Coordinates are
    the only option.

  Coordinates MUST be relative to the JianyingPro window, not the whole screen.
  Blind full-screen clicks hit whatever window happens to be on top (that is
  how the Windows Settings window got opened by accident before).

  Usage:
    .\jy-click.ps1 -X 0.2 -Y 0.75            # relative 0..1 of client area
    .\jy-click.ps1 -Px 400 -Py 800           # pixel offset inside client area
    .\jy-click.ps1 -Sx 427 -Sy 440           # pixel in the 1100-wide screenshot
    .\jy-click.ps1 -X 0.4 -Y 0.7 -DoubleClick
#>
param(
  [double]$X = -1,
  [double]$Y = -1,
  [int]$Px = -1,
  [int]$Py = -1,
  [int]$Sx = -1,
  [int]$Sy = -1,
  [int]$ShotWidth = 1100,
  [switch]$DoubleClick
)

Add-Type -AssemblyName System.Windows.Forms

$sig = @'
using System;
using System.Runtime.InteropServices;
public class W32C {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, int e);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
}
'@
if (-not ('W32C' -as [type])) { Add-Type -TypeDefinition $sig }

$p = Get-Process -Name JianyingPro -ErrorAction SilentlyContinue |
     Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { Write-Output "ERROR: JianyingPro window not found"; exit 1 }

$h = $p.MainWindowHandle
[void][W32C]::ShowWindow($h, 9)
Start-Sleep -Milliseconds 300
[void][W32C]::SetForegroundWindow($h)
Start-Sleep -Milliseconds 600

# Verify JianyingPro really is in front before clicking.
$fg = [W32C]::GetForegroundWindow()
if ($fg -ne $h) {
  $len = [W32C]::GetWindowTextLength($fg)
  $sb = New-Object System.Text.StringBuilder ($len + 1)
  [void][W32C]::GetWindowText($fg, $sb, $sb.Capacity)
  Write-Output "ABORT: foreground is not JianyingPro (it is: '$($sb.ToString())')"
  exit 3
}

$cr = New-Object W32C+RECT
[void][W32C]::GetClientRect($h, [ref]$cr)
$cw = $cr.Right - $cr.Left
$ch = $cr.Bottom - $cr.Top

if ($Px -ge 0 -and $Py -ge 0) {
  # window-relative pixel -> absolute screen pixel
  $pt = New-Object W32C+POINT
  $pt.X = $Px; $pt.Y = $Py
  [void][W32C]::ClientToScreen($h, [ref]$pt)
  $absX = $pt.X; $absY = $pt.Y
} elseif ($Sx -ge 0 -and $Sy -ge 0) {
  # screenshot pixel -> absolute screen pixel
  $sb2 = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $scale = $sb2.Width / [double]$ShotWidth
  $absX = [int]($Sx * $scale)
  $absY = [int]($Sy * $scale)
} elseif ($X -ge 0 -and $Y -ge 0) {
  $cx = [int]($cw * $X); $cy = [int]($ch * $Y)
  $pt = New-Object W32C+POINT
  $pt.X = $cx; $pt.Y = $cy
  [void][W32C]::ClientToScreen($h, [ref]$pt)
  $absX = $pt.X; $absY = $pt.Y
} else {
  Write-Output "ERROR: need -X/-Y, -Px/-Py or -Sx/-Sy"; exit 2
}

Write-Output "client=${cw}x${ch} screen=($absX,$absY)"

[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point $absX, $absY
Start-Sleep -Milliseconds 250
[W32C]::mouse_event(0x0002, 0, 0, 0, 0)
Start-Sleep -Milliseconds 70
[W32C]::mouse_event(0x0004, 0, 0, 0, 0)
if ($DoubleClick) {
  Start-Sleep -Milliseconds 90
  [W32C]::mouse_event(0x0002, 0, 0, 0, 0)
  Start-Sleep -Milliseconds 70
  [W32C]::mouse_event(0x0004, 0, 0, 0, 0)
}
Write-Output "clicked"
