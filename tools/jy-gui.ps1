<#
  jy-gui.ps1 - 可靠地操作剪映窗口（不盲点坐标）

  之前盲点坐标点到了 Windows 设置，因为无法确认窗口焦点与位置。
  这里改为：
    1. 用 Win32 SetForegroundWindow 强制把剪映提到前台
    2. 截图前先确认前台窗口标题确实是剪映
    3. 需要点击时用 UI Automation 按控件名查找，而不是猜坐标

  用法:
    .\jy-gui.ps1 -Action focus
    .\jy-gui.ps1 -Action shot -Out x.png
    .\jy-gui.ps1 -Action list          # 列出所有可见控件树
    .\jy-gui.ps1 -Action click -Name "本地草稿"
#>
param(
  [Parameter(Mandatory=$true)]
  [ValidateSet('focus','shot','list','click','info')]
  [string]$Action,
  [string]$Out = "D:\Linvis-AI-Studio\out\jy-test\gui.png",
  [string]$Name,
  [int]$Width = 1100
)

Add-Type -AssemblyName System.Windows.Forms, System.Drawing, UIAutomationClient, UIAutomationTypes

$sig = @'
using System;
using System.Runtime.InteropServices;
public class W32 {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
'@
if (-not ('W32' -as [type])) { Add-Type -TypeDefinition $sig }

function Get-ForegroundTitle {
  $h = [W32]::GetForegroundWindow()
  $len = [W32]::GetWindowTextLength($h)
  $sb = New-Object System.Text.StringBuilder ($len + 1)
  [void][W32]::GetWindowText($h, $sb, $sb.Capacity)
  return $sb.ToString()
}

function Get-JyWindow {
  Get-Process -Name JianyingPro -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 } |
    Select-Object -First 1
}

function Focus-Jy {
  $p = Get-JyWindow
  if (-not $p) { throw "剪映主窗口未找到（进程可能已退出）" }
  [void][W32]::ShowWindow($p.MainWindowHandle, 9)   # SW_RESTORE
  Start-Sleep -Milliseconds 300
  [void][W32]::SetForegroundWindow($p.MainWindowHandle)
  Start-Sleep -Milliseconds 600
  $t = Get-ForegroundTitle
  Write-Output "foreground: $t"
  if ($t -notmatch '剪映|Jianying') {
    Write-Output "WARN: 前台不是剪映，可能被其它窗口抢占"
  }
  return $p
}

function Take-Shot([string]$path, [int]$w) {
  $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($b.X, $b.Y, 0, 0, $bmp.Size)
  $h = [int]($b.Height * $w / $b.Width)
  $small = New-Object System.Drawing.Bitmap $w, $h
  $g2 = [System.Drawing.Graphics]::FromImage($small)
  $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g2.DrawImage($bmp, 0, 0, $w, $h)
  $small.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $g2.Dispose(); $small.Dispose(); $bmp.Dispose()
  Write-Output "saved $path"
}

function Get-UiRoot($hwnd) {
  $AE = [System.Windows.Automation.AutomationElement]
  return $AE::FromHandle($hwnd)
}

switch ($Action) {
  'focus' { [void](Focus-Jy) }

  'info' {
    $p = Get-JyWindow
    if (-not $p) { Write-Output "not running"; break }
    $r = New-Object W32+RECT
    [void][W32]::GetWindowRect($p.MainWindowHandle, [ref]$r)
    Write-Output "pid=$($p.Id) title='$($p.MainWindowTitle)'"
    Write-Output "rect=($($r.Left),$($r.Top))-($($r.Right),$($r.Bottom))"
  }

  'shot' {
    [void](Focus-Jy)
    Take-Shot $Out $Width
  }

  'list' {
    $p = Focus-Jy
    $root = Get-UiRoot $p.MainWindowHandle
    $all = $root.FindAll(
      [System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.Condition]::TrueCondition)
    Write-Output "total elements: $($all.Count)"
    $i = 0
    foreach ($e in $all) {
      $n = $e.Current.Name
      $ct = $e.Current.ControlType.ProgrammaticName
      if ($n) {
        $b = $e.Current.BoundingRectangle
        Write-Output ("[{0}] {1,-28} '{2}' @ {3},{4} {5}x{6}" -f $i, $ct.Replace('ControlType.',''), $n, [int]$b.X, [int]$b.Y, [int]$b.Width, [int]$b.Height)
      }
      $i++
    }
  }

  'click' {
    if (-not $Name) { throw "-Name required for click" }
    $p = Focus-Jy
    $root = Get-UiRoot $p.MainWindowHandle
    $all = $root.FindAll(
      [System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.Condition]::TrueCondition)
    $hit = $null
    foreach ($e in $all) {
      if ($e.Current.Name -and $e.Current.Name -like "*$Name*") { $hit = $e; break }
    }
    if (-not $hit) { Write-Output "NOT FOUND: $Name"; break }
    $b = $hit.Current.BoundingRectangle
    Write-Output "found '$($hit.Current.Name)' at $([int]$b.X),$([int]$b.Y) $([int]$b.Width)x$([int]$b.Height)"
    $pt = New-Object System.Windows.Point (($b.X + $b.Width/2)), (($b.Y + $b.Height/2))
    [System.Windows.Forms.Cursor]::Position = $pt
    Start-Sleep -Milliseconds 200
    Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(uint f,uint x,uint y,uint d,int e);' -Name M -Namespace W
    [W.M]::mouse_event(0x0002,0,0,0,0)
    Start-Sleep -Milliseconds 60
    [W.M]::mouse_event(0x0004,0,0,0,0)
    Write-Output "clicked"
  }
}
