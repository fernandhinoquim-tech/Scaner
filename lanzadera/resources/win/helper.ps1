# Lanzadera - ayudante de Windows.
#   -Mode apps   : lista las apps del menu Inicio (incluidas las de Microsoft Store) en JSON.
#   -Mode icons  : extrae iconos en alta resolucion (256 px) a archivos PNG.
param(
  [Parameter(Mandatory = $true)][string]$Mode,
  [string]$In = '',
  [string]$Out = '',
  [int]$Size = 256,
  [int]$ParentPid = 0
)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch {}

function Write-Json($obj) {
  $json = ConvertTo-Json -InputObject $obj -Compress -Depth 4
  [Console]::Out.Write($json)
  [Console]::Out.Flush()
}

if ($Mode -eq 'apps') {
  $list = @()
  try {
    $list = @(Get-StartApps | ForEach-Object { [pscustomobject]@{ name = [string]$_.Name; appId = [string]$_.AppID } })
  } catch {
    $list = @()
  }
  if ($list.Count -eq 0) {
    try {
      $shell = New-Object -ComObject Shell.Application
      $folder = $shell.NameSpace('shell:AppsFolder')
      $list = @($folder.Items() | ForEach-Object { [pscustomobject]@{ name = [string]$_.Name; appId = [string]$_.Path } })
    } catch {}
  }
  Write-Json @($list)
  exit 0
}

if ($Mode -eq 'icons') {
  $cs = @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class LzIcons {
  [StructLayout(LayoutKind.Sequential)]
  public struct SIZE { public int cx; public int cy; public SIZE(int x, int y) { cx = x; cy = y; } }

  [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IShellItemImageFactory {
    [PreserveSig] int GetImage(SIZE size, int flags, out IntPtr phbm);
  }

  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  static extern void SHCreateItemFromParsingName([MarshalAs(UnmanagedType.LPWStr)] string path, IntPtr pbc,
    [MarshalAs(UnmanagedType.LPStruct)] Guid riid, [MarshalAs(UnmanagedType.Interface)] out IShellItemImageFactory ppv);

  [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr h);
  [DllImport("user32.dll")] static extern bool DestroyIcon(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  static extern uint PrivateExtractIcons(string file, int index, int cx, int cy, IntPtr[] icons, uint[] ids, uint count, uint flags);

  static Bitmap FromHBitmap(IntPtr hbmp) {
    using (Bitmap tmp = Image.FromHbitmap(hbmp)) {
      int w = tmp.Width, h = tmp.Height;
      if (Image.GetPixelFormatSize(tmp.PixelFormat) < 32) return new Bitmap(tmp);
      Rectangle r = new Rectangle(0, 0, w, h);
      BitmapData src = tmp.LockBits(r, ImageLockMode.ReadOnly, tmp.PixelFormat);
      int stride = Math.Abs(src.Stride);
      byte[] buf = new byte[stride * h];
      Marshal.Copy(src.Scan0, buf, 0, buf.Length);
      tmp.UnlockBits(src);
      bool alpha = false;
      for (int i = 3; i < buf.Length; i += 4) { if (buf[i] != 0) { alpha = true; break; } }
      if (!alpha) { for (int i = 3; i < buf.Length; i += 4) buf[i] = 255; }
      Bitmap res = new Bitmap(w, h, PixelFormat.Format32bppArgb);
      BitmapData dst = res.LockBits(r, ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
      for (int y = 0; y < h; y++) Marshal.Copy(buf, y * stride, IntPtr.Add(dst.Scan0, y * dst.Stride), w * 4);
      res.UnlockBits(dst);
      return res;
    }
  }

  static Bitmap FromShell(string path, int size) {
    IShellItemImageFactory f;
    SHCreateItemFromParsingName(path, IntPtr.Zero, typeof(IShellItemImageFactory).GUID, out f);
    IntPtr hbmp = IntPtr.Zero;
    int hr;
    try { hr = f.GetImage(new SIZE(size, size), 0x4, out hbmp); }
    finally { Marshal.ReleaseComObject(f); }
    if (hr != 0 || hbmp == IntPtr.Zero) return null;
    try { return FromHBitmap(hbmp); } finally { DeleteObject(hbmp); }
  }

  static Bitmap FromIconIndex(string file, int index, int size) {
    IntPtr[] h = new IntPtr[1];
    uint[] ids = new uint[1];
    uint n = PrivateExtractIcons(file, index, size, size, h, ids, 1, 0);
    if (n == 0 || n == 0xFFFFFFFF || h[0] == IntPtr.Zero) return null;
    try { using (Icon ic = Icon.FromHandle(h[0])) { return ic.ToBitmap(); } }
    finally { DestroyIcon(h[0]); }
  }

  // Si el icono real es pequeno dentro del lienzo, lo recorta y lo centra.
  static Bitmap Normalize(Bitmap b, int size) {
    int w = b.Width, h = b.Height, minX = w, minY = h, maxX = -1, maxY = -1;
    BitmapData d = b.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
    int stride = d.Stride;
    byte[] buf = new byte[stride * h];
    Marshal.Copy(d.Scan0, buf, 0, buf.Length);
    b.UnlockBits(d);
    for (int y = 0; y < h; y++) {
      for (int x = 0; x < w; x++) {
        if (buf[y * stride + x * 4 + 3] > 10) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null;
    int side = Math.Max(maxX - minX + 1, maxY - minY + 1);
    if (side >= w * 0.72 && w == size && h == size) return b;
    side = Math.Min(Math.Min(w, h), side + (int)(side * 0.12));
    int cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    int sx = Math.Max(0, Math.Min(w - side, cx - side / 2));
    int sy = Math.Max(0, Math.Min(h - side, cy - side / 2));
    Bitmap res = new Bitmap(size, size, PixelFormat.Format32bppArgb);
    using (Graphics g = Graphics.FromImage(res))
    using (ImageAttributes ia = new ImageAttributes()) {
      ia.SetWrapMode(WrapMode.TileFlipXY);
      g.InterpolationMode = InterpolationMode.HighQualityBicubic;
      g.PixelOffsetMode = PixelOffsetMode.HighQuality;
      g.CompositingQuality = CompositingQuality.HighQuality;
      g.SmoothingMode = SmoothingMode.HighQuality;
      g.Clear(Color.Transparent);
      g.DrawImage(b, new Rectangle(0, 0, size, size), sx, sy, side, side, GraphicsUnit.Pixel, ia);
    }
    b.Dispose();
    return res;
  }

  public static bool Save(string path, int index, bool useIndex, string dest, int size) {
    Bitmap b = null;
    if (useIndex) { try { b = FromIconIndex(path, index, size); } catch { b = null; } }
    if (b == null) b = FromShell(path, size);
    if (b == null) return false;
    Bitmap n = Normalize(b, size);
    if (n == null) { b.Dispose(); return false; }
    n.Save(dest, ImageFormat.Png);
    n.Dispose();
    return true;
  }
}
'@
  Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition $cs
  $items = Get-Content -LiteralPath $In -Raw -Encoding UTF8 | ConvertFrom-Json
  $res = New-Object System.Collections.ArrayList
  foreach ($it in @($items)) {
    $ok = $false
    $err = ''
    try {
      $dest = Join-Path $Out ([string]$it.key + '.png')
      $ok = [LzIcons]::Save([string]$it.path, [int]$it.index, [bool]$it.useIndex, $dest, $Size)
    } catch {
      $err = $_.Exception.Message
    }
    [void]$res.Add([pscustomobject]@{ key = [string]$it.key; ok = [bool]$ok; error = [string]$err })
  }
  Write-Json @($res)
  exit 0
}

if ($Mode -eq 'watch') {
  # Vigila si la ventana activa ocupa toda una pantalla (video o juego en pantalla completa).
  $cs = @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class LzFg {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO mi);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern IntPtr GetShellWindow();
  [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr ctx);

  public static void Init() { try { SetThreadDpiAwarenessContext(new IntPtr(-4)); } catch { } }

  public static string State() {
    IntPtr h = GetForegroundWindow();
    if (h == IntPtr.Zero || h == GetShellWindow() || !IsWindowVisible(h) || IsZoomed(h)) return "0";
    StringBuilder sb = new StringBuilder(256);
    GetClassName(h, sb, 256);
    string c = sb.ToString();
    if (c == "Progman" || c == "WorkerW" || c == "Shell_TrayWnd" || c == "Shell_SecondaryTrayWnd" || c == "Windows.UI.Core.CoreWindow" || c == "XamlExplorerHostIslandWindow") return "0";
    RECT r;
    if (!GetWindowRect(h, out r)) return "0";
    MONITORINFO mi = new MONITORINFO();
    mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
    if (!GetMonitorInfo(MonitorFromWindow(h, 2), ref mi)) return "0";
    RECT m = mi.rcMonitor;
    bool full = r.L <= m.L && r.T <= m.T && r.R >= m.R && r.B >= m.B;
    return full ? ("1," + m.L + "," + m.T + "," + m.R + "," + m.B) : "0";
  }
}
'@
  Add-Type -TypeDefinition $cs
  [LzFg]::Init()
  $last = ''
  $n = 0
  while ($true) {
    $s = [LzFg]::State()
    if ($s -ne $last) {
      [Console]::Out.WriteLine($s)
      [Console]::Out.Flush()
      $last = $s
    }
    Start-Sleep -Milliseconds 700
    $n++
    if ($ParentPid -gt 0 -and ($n % 6) -eq 0) {
      if (-not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { exit 0 }
    }
  }
}

Write-Error "Modo desconocido: $Mode"
exit 2
