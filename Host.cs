using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using System.Management.Automation;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal static class HostLog
{
    private static readonly object Sync = new object();
    public static string FilePath;

    public static void Write(string message)
    {
        try
        {
            lock (Sync)
            {
                File.AppendAllText(FilePath, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff") + "  " + message + Environment.NewLine, Encoding.UTF8);
            }
        }
        catch { }
    }
}

internal static class EmbeddedRuntime
{
    private const string AppPrefix = "FreakShow.App.";
    private static readonly Assembly ExecutingAssembly = Assembly.GetExecutingAssembly();
    private static string runtimeRoot;

    public static string Prepare()
    {
        string parent = Path.Combine(Path.GetTempPath(), "FreakShow-Embedded");
        CleanupOldRuntimeDirectories(parent);
        runtimeRoot = Path.Combine(parent, Process.GetCurrentProcess().Id.ToString() + "-" + Guid.NewGuid().ToString("N"));
        string appRoot = Path.Combine(runtimeRoot, "app");
        Directory.CreateDirectory(appRoot);

        string[] resources = ExecutingAssembly.GetManifestResourceNames();
        int appFiles = 0;
        for (int i = 0; i < resources.Length; i++)
        {
            string resource = resources[i];
            if (!resource.StartsWith(AppPrefix, StringComparison.Ordinal)) continue;
            string fileName = resource.Substring(AppPrefix.Length);
            if (String.IsNullOrWhiteSpace(fileName) || !String.Equals(fileName, Path.GetFileName(fileName), StringComparison.Ordinal))
                throw new InvalidOperationException("Ungültige eingebettete App-Ressource: " + resource);
            ExtractResource(resource, Path.Combine(appRoot, fileName));
            appFiles++;
        }
        if (appFiles == 0 || !File.Exists(Path.Combine(appRoot, "index.html")) || !File.Exists(Path.Combine(appRoot, "websocket-diagnose.html")))
            throw new InvalidOperationException("Die eingebettete FreakShow-Weboberfläche ist unvollständig.");

        HostLog.Write("Embedded runtime prepared. AppFiles=" + appFiles);
        return appRoot;
    }

    private static void ExtractResource(string resourceName, string destination)
    {
        using (Stream input = ExecutingAssembly.GetManifestResourceStream(resourceName))
        {
            if (input == null) throw new InvalidOperationException("Embedded resource missing: " + resourceName);
            using (FileStream output = new FileStream(destination, FileMode.Create, FileAccess.Write, FileShare.Read)) input.CopyTo(output);
        }
    }

    private static void CleanupOldRuntimeDirectories(string parent)
    {
        try
        {
            if (!Directory.Exists(parent)) return;
            string fullParent = Path.GetFullPath(parent).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            string[] directories = Directory.GetDirectories(parent);
            for (int i = 0; i < directories.Length; i++)
            {
                string full = Path.GetFullPath(directories[i]);
                if (full.StartsWith(fullParent, StringComparison.OrdinalIgnoreCase))
                {
                    try { Directory.Delete(full, true); } catch { }
                }
            }
        }
        catch { }
    }

    public static void Cleanup()
    {
        try
        {
            if (String.IsNullOrWhiteSpace(runtimeRoot) || !Directory.Exists(runtimeRoot)) return;
            string parent = Path.GetFullPath(Path.Combine(Path.GetTempPath(), "FreakShow-Embedded")).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            string full = Path.GetFullPath(runtimeRoot);
            if (full.StartsWith(parent, StringComparison.OrdinalIgnoreCase)) Directory.Delete(full, true);
        }
        catch { }
    }
}

internal sealed class EmbeddedBridge : IDisposable
{
    private readonly string contentRoot;
    private readonly string exePath;
    private readonly string appRoot;
    private Thread thread;
    private PowerShell shell;
    private volatile bool disposed;

    public EmbeddedBridge(string contentRoot, string exePath, string appRoot)
    {
        this.contentRoot = contentRoot;
        this.exePath = exePath;
        this.appRoot = appRoot;
    }

    public void Start()
    {
        thread = new Thread(Run);
        thread.IsBackground = true;
        thread.Name = "FreakShow embedded bridge";
        thread.Start();
    }

    private static string ResourceText(string name)
    {
        using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(name))
        {
            if (stream == null) throw new InvalidOperationException("Embedded resource missing: " + name);
            using (StreamReader reader = new StreamReader(stream, Encoding.UTF8, true)) return reader.ReadToEnd();
        }
    }

    private void Run()
    {
        try
        {
            string script = ResourceText("EmbeddedBridge.ps1");
            PowerShell ps = PowerShell.Create();
            shell = ps;
            ps.AddScript(script, false);
            ps.AddParameter("Port", 18081);
            string baseDir = Path.GetDirectoryName(exePath);
            string dataConfig = Path.Combine(baseDir, "data", "config");
            string dataState = Path.Combine(baseDir, "data", "state");
            ps.AddParameter("SettingsPath", Path.Combine(dataConfig, "emote-rain-settings.json"));
            ps.AddParameter("PositionPreviewPath", Path.Combine(dataState, "overlay-position-preview.json"));
            ps.AddParameter("ExternalLinksPath", Path.Combine(dataConfig, "external-overlay-links.json"));
            ps.AddParameter("VideoOverlaysPath", Path.Combine(dataConfig, "video-overlay-settings.json"));
            ps.AddParameter("VideoPausePath", Path.Combine(dataState, "video-pause.json"));
            ps.AddParameter("EmoteRainUsersPath", Path.Combine(dataConfig, "emote-rain-users.json"));
            ps.AddParameter("OverlayLayersPath", Path.Combine(dataConfig, "overlay-layers.json"));
            ps.AddParameter("ImageOverlaysPath", Path.Combine(dataConfig, "image-overlays.json"));
            ps.AddParameter("ExcludedAppsPath", Path.Combine(dataConfig, "excluded-apps.json"));
            ps.AddParameter("OverlayOutputPath", Path.Combine(dataState, "overlay-output.json"));
            ps.AddParameter("CheatsheetPath", Path.Combine(dataConfig, "cheatsheet.json"));
            ps.AddParameter("OverlayMonitorPath", Path.Combine(dataConfig, "overlay-monitor.json"));
            ps.AddParameter("PauseHotkeyPath", Path.Combine(dataConfig, "pause-hotkey.json"));
            ps.AddParameter("UiStatePath", Path.Combine(dataConfig, "ui-state.json"));
            ps.AddParameter("PrivateUiStatePath", Path.Combine(dataConfig, "ui-private-state.dat"));
            ps.AddParameter("GameControlsPath", Path.Combine(dataConfig, "game-controls.json"));
            ps.AddParameter("GameAutomationRoot", Path.Combine(baseDir, "automation"));
            ps.AddParameter("AutoHotkeyRuntimeRoot", Path.Combine(baseDir, "runtime", "AutoHotkey"));
            ps.AddParameter("AllowedIpsPath", Path.Combine(dataConfig, "allowed-ips.json"));
            ps.AddParameter("WebSocketConfigPath", Path.Combine(dataConfig, "websocket-config.json"));
            ps.AddParameter("AppRoot", appRoot);
            ps.AddParameter("ContentRoot", contentRoot);
            ps.AddParameter("OverlayExePath", exePath);
            ps.AddParameter("SettingsPagePath", Path.Combine(appRoot, "websocket-diagnose.html"));
            ps.AddParameter("ChatImportCode", ResourceText("FreakShow.ChatSenderImport"));
            ps.AddParameter("OutputImportCode", ResourceText("FreakShow.OutputReceiverImport"));
            ps.AddParameter("ProcessEventImportCode", ResourceText("FreakShow.ProcessEventImport"));
            ps.AddParameter("EmbeddedHost", true);
            ps.Streams.Error.DataAdded += delegate(object sender, DataAddedEventArgs e)
            {
                try { HostLog.Write("BRIDGE ERROR: " + ps.Streams.Error[e.Index].ToString()); } catch { }
            };
            HostLog.Write("Embedded bridge starting on 127.0.0.1:18081");
            ps.Invoke();
            if (!disposed) HostLog.Write("Embedded bridge stopped unexpectedly.");
        }
        catch (Exception ex)
        {
            HostLog.Write("Embedded bridge fatal error: " + ex);
        }
    }

    public void Dispose()
    {
        disposed = true;
        try { if (shell != null) shell.Stop(); } catch { }
        try { if (shell != null) shell.Dispose(); } catch { }
        shell = null;
        try { if (thread != null && thread.IsAlive) thread.Join(2000); } catch { }
    }
}

internal sealed class OverlayForm : Form
{
    private const int WS_EX_TRANSPARENT = 0x20;
    private const int WS_EX_TOOLWINDOW = 0x80;
    private const int WS_EX_TOPMOST = 0x8;
    private const int WS_EX_LAYERED = 0x80000;
    private const int WS_EX_NOACTIVATE = 0x08000000;
    private const int GWL_EXSTYLE = -20;
    private const uint SWP_NOSIZE = 0x0001;
    private const uint SWP_NOMOVE = 0x0002;
    private const uint SWP_NOACTIVATE = 0x0010;
    private const uint SWP_NOOWNERZORDER = 0x0200;
    private const uint SWP_NOSENDCHANGING = 0x0400;
    private static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint flags);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtr", SetLastError = true)]
    private static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int index);

    [DllImport("user32.dll", EntryPoint = "GetWindowLong", SetLastError = true)]
    private static extern IntPtr GetWindowLongPtr32(IntPtr hWnd, int index);

    private readonly string contentRoot;
    private readonly WebView2 web;
    private readonly System.Windows.Forms.Timer monitorTimer;
    private readonly System.Windows.Forms.Timer sbStartupTimer;
    private readonly System.Windows.Forms.Timer updateTimer;
    // Zusätzliche transparente Fenster für gezielt geroutete Notizen und
    // Web-Overlays auf den anderen physischen Monitoren.
    private readonly Dictionary<int, OverlaySatelliteForm> satelliteForms = new Dictionary<int, OverlaySatelliteForm>();
    private bool overlayNavigationReady;
    private NotifyIcon tray;
    private ToolStripMenuItem updateMenuItem;
    private UpdateManifest availableUpdate;
    private bool updateCheckInFlight;
    private string notifiedUpdateVersion;
    private int lastMonitor = -999;
    private DateTime lastTopMostFailureLog = DateTime.MinValue;
    private DateTime sbStartupWatchStarted = DateTime.MinValue;
    private DateTime lastSbStartupReload = DateTime.MinValue;
    private int sbStartupReloads;
    private bool sbStatusCheckInFlight;

    // --- Globales Tastenkuerzel: schaltet die "Overlay-Ausgabe" systemweit um (auch im Spiel) ---
    // Die Taste kommt aus data/config/pause-hotkey.json (von der Einstellungsseite gesetzt),
    // die Umschaltung schreibt data/state/overlay-output.json (dasselbe wie der UI-Schalter).
    [DllImport("user32.dll")] private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);
    [DllImport("user32.dll")] private static extern bool UnregisterHotKey(IntPtr hWnd, int id);
    private const int WM_HOTKEY = 0x0312;
    private const int HOTKEY_ID = 0xB001;
    private const uint MOD_ALT = 0x0001, MOD_CONTROL = 0x0002, MOD_SHIFT = 0x0004, MOD_NOREPEAT = 0x4000;
    private string lastHotkeyRaw = null;

    public OverlayForm(string contentRoot)
    {
        this.contentRoot = contentRoot;
        Text = "FreakShow";
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.Manual;
        Bounds = Screen.PrimaryScreen.Bounds;
        TopMost = true;
        ShowInTaskbar = false;
        BackColor = Color.Magenta;
        TransparencyKey = Color.Magenta;
        DoubleBuffered = true;

        web = new WebView2();
        web.Dock = DockStyle.Fill;
        web.DefaultBackgroundColor = Color.Transparent;
        Controls.Add(web);

        monitorTimer = new System.Windows.Forms.Timer();
        monitorTimer.Interval = 1500;
        monitorTimer.Tick += delegate { ApplySelectedMonitor(); SyncHotkeyRegistration(); EnsureTopMost("timer"); };

        // Zweite Absicherung fuer den Windows-Autostart: Wenn die LAN-Verbindung
        // beim ersten WebView-Start noch nicht bereit war, wird nur die Overlay-Seite
        // begrenzt neu geladen. Das entspricht dem erfolgreichen manuellen Neustart,
        // ohne Bridge, Einstellungen oder die ganze EXE neu zu starten.
        sbStartupTimer = new System.Windows.Forms.Timer();
        sbStartupTimer.Interval = 5000;
        sbStartupTimer.Tick += async delegate { await CheckStreamerBotStartupAsync(); };

        // Erst nach dem normalen Programmstart pruefen. Danach reicht eine stille
        // Pruefung alle sechs Stunden; installiert wird immer erst nach Benutzerklick.
        updateTimer = new System.Windows.Forms.Timer();
        updateTimer.Interval = 30000;
        updateTimer.Tick += async delegate
        {
            updateTimer.Stop();
            await CheckForUpdatesAsync(false);
            updateTimer.Interval = 6 * 60 * 60 * 1000;
            if (!IsDisposed && !Disposing) updateTimer.Start();
        };

        Load += delegate { InitializeAsync(); };
        FormClosed += delegate { CloseSatelliteForms(); try { UnregisterHotKey(Handle, HOTKEY_ID); } catch { } try { sbStartupTimer.Stop(); } catch { } try { updateTimer.Stop(); } catch { } if (tray != null) { tray.Visible = false; tray.Dispose(); } };
        CreateTray();
    }

    protected override CreateParams CreateParams
    {
        get
        {
            CreateParams cp = base.CreateParams;
            cp.ExStyle |= WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_TOPMOST | WS_EX_LAYERED | WS_EX_NOACTIVATE;
            return cp;
        }
    }

    protected override bool ShowWithoutActivation { get { return true; } }

    private static IntPtr GetExtendedStyle(IntPtr hWnd)
    {
        return IntPtr.Size == 8 ? GetWindowLongPtr64(hWnd, GWL_EXSTYLE) : GetWindowLongPtr32(hWnd, GWL_EXSTYLE);
    }

    // Ein exklusives Vollbild oder ein fremdes Fenster kann die Z-Reihenfolge des
    // click-through Overlays verschieben. Da WS_EX_NOACTIVATE keinen Fokus erlaubt,
    // kann sich das Fenster danach nicht durch Anklicken selbst wieder nach vorne holen.
    // Deshalb wird die Topmost-Band-Position ohne Aktivierung regelmaessig aufgefrischt.
    private void EnsureTopMost(string reason)
    {
        if (IsDisposed || Disposing || !IsHandleCreated || !Visible) return;
        try
        {
            long exStyle = GetExtendedStyle(Handle).ToInt64();
            bool hadTopMostStyle = (exStyle & WS_EX_TOPMOST) != 0;
            bool ok = SetWindowPos(
                Handle,
                HWND_TOPMOST,
                0, 0, 0, 0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_NOSENDCHANGING);

            if (ok)
            {
                if (!hadTopMostStyle) HostLog.Write("Overlay topmost state restored (" + reason + ").");
                lastTopMostFailureLog = DateTime.MinValue;
            }
            else if ((DateTime.UtcNow - lastTopMostFailureLog).TotalSeconds >= 30)
            {
                lastTopMostFailureLog = DateTime.UtcNow;
                HostLog.Write("Overlay topmost refresh FAILED (" + reason + "), Win32=" + Marshal.GetLastWin32Error() + ".");
            }
        }
        catch (Exception ex)
        {
            if ((DateTime.UtcNow - lastTopMostFailureLog).TotalSeconds >= 30)
            {
                lastTopMostFailureLog = DateTime.UtcNow;
                HostLog.Write("Overlay topmost refresh error (" + reason + "): " + ex.Message);
            }
        }
    }

    protected override void OnShown(EventArgs e)
    {
        base.OnShown(e);
        EnsureTopMost("shown");
    }

    protected override void OnVisibleChanged(EventArgs e)
    {
        base.OnVisibleChanged(e);
        if (Visible && IsHandleCreated)
        {
            try { BeginInvoke((MethodInvoker)delegate { EnsureTopMost("visible"); }); } catch { }
        }
    }

    private async void InitializeAsync()
    {
        try
        {
            ApplySelectedMonitor();
            string data = Path.Combine(Path.GetDirectoryName(Application.ExecutablePath), "WebView2UserData");
            CoreWebView2EnvironmentOptions options = new CoreWebView2EnvironmentOptions("--disable-http-cache --disk-cache-size=1 --autoplay-policy=no-user-gesture-required");
            CoreWebView2Environment environment = await CoreWebView2Environment.CreateAsync(null, data, options);
            await web.EnsureCoreWebView2Async(environment);
            web.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
            web.CoreWebView2.Settings.AreDevToolsEnabled = false;
            web.CoreWebView2.Settings.IsStatusBarEnabled = false;
            web.CoreWebView2.Settings.IsZoomControlEnabled = false;
            web.CoreWebView2.PermissionRequested += delegate(object sender, CoreWebView2PermissionRequestedEventArgs e)
            {
                e.State = CoreWebView2PermissionState.Allow;
            };
            web.CoreWebView2.ProcessFailed += delegate
            {
                HostLog.Write("WebView2 process failed; reloading overlay.");
                try { web.Reload(); } catch { }
            };
            await EnableTwitchWidgetEmbedding();
            await EnableOverlayBackgroundRemoval();
            await WaitForBridge();
            await WaitForStreamerBotEndpoint();
            overlayNavigationReady = true;
            NavigatePrimaryOverlay(lastMonitor < 0 ? 0 : lastMonitor);
            SyncSatelliteForms(lastMonitor < 0 ? 0 : lastMonitor);
            sbStartupWatchStarted = DateTime.UtcNow;
            lastSbStartupReload = DateTime.MinValue;
            sbStartupReloads = 0;
            sbStartupTimer.Start();
            monitorTimer.Start();
            updateTimer.Start();
            string installedVersion = UpdateService.ConsumeSuccessfulUpdate(Path.GetDirectoryName(Application.ExecutablePath));
            if (!String.IsNullOrWhiteSpace(installedVersion) && tray != null)
            {
                tray.ShowBalloonTip(7000, UpdateText.UpdatedTitle, UpdateText.UpdatedBody(installedVersion), ToolTipIcon.Info);
            }
            HostLog.Write("Overlay navigation started.");
        }
        catch (Exception ex)
        {
            HostLog.Write("WebView2 initialization failed: " + ex);
            MessageBox.Show("FreakShow konnte WebView2 nicht starten.\n\n" + ex.Message, "FreakShow", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
        }
    }

    // ===== Schalter "Hintergrund entfernen" fuer Web-Overlays =====
    // Ein Chat-Overlay wie chat.streamer.bot zeichnet seine Nachrichten auf
    // eingefaerbte Kacheln. Von aussen ist da nicht heranzukommen: der iframe hat
    // eine fremde Herkunft, und ein Umweg ueber die Bridge scheidet aus, weil solche
    // Seiten Single-Page-Apps mit eigenem Routing sind - unter fremdem Pfad zeigen
    // sie nur "Page not found". Deshalb bekommt JEDES Dokument im Overlay-Fenster,
    // auch ein fremdes iframe, dieses winzige Skript mit. Es wartet auf eine
    // Nachricht der Overlay-Seite und blendet den Hintergrund genau dort aus, wo es
    // erlaubt ist: im Dokument selbst. Ohne diese Nachricht tut es nichts.
    internal const string OverlayBackgroundScript = @"
(function () {
  if (window.__freakshowBackgroundBridge) return;
  window.__freakshowBackgroundBridge = true;
  var STYLE_ID = 'freakshow-hide-background';
  // Nur Flaechen entfernen, nicht den Inhalt: Text, Symbole (svg) und Emotes (img)
  // bleiben unberuehrt, weil hier ausschliesslich Fuellfarbe und Schatten fallen.
  // Die beiden :not(...) tragen nichts zur Auswahl bei - sie heben nur die
  // Prioritaet der Regel ueber die der Overlay-Seite, denn Baukaesten wie Tailwind
  // setzen Hintergruende teilweise selbst schon mit zwei Klassenstufen.
  // ::before/::after muessen mit, weil Kacheln dort haeufig gezeichnet werden.
  var KEEP = ':not(.freakshow-keep-bg):not(.freakshow-keep-shadow)';
  var SEL = 'html body *' + KEEP;
  // color-scheme MUSS zurueckgesetzt werden. Seiten im Dunkelmodus (chat.streamer.bot
  // setzt class=dark samt color-scheme) bekommen vom Browser eine SCHWARZE Grundflaeche
  // hinter dem Inhalt. Die stammt nicht aus dem Seiten-CSS, sondern von der Darstellung
  // selbst - Hintergrundregeln allein erwischen sie deshalb nicht.
  var CSS = 'html{color-scheme:normal !important;}'
    + 'html,body{background:transparent !important;background-image:none !important;}'
    + SEL + '{background-color:transparent !important;box-shadow:none !important;}'
    + SEL + '::before,' + SEL + '::after{background-color:transparent !important;box-shadow:none !important;}';
  var wanted = null;
  var appliedEarly = false;

  function apply(on) {
    try {
      var root = document.documentElement;
      if (!root) return;
      var style = document.getElementById(STYLE_ID);
      if (!on) {
        if (style && style.parentNode) style.parentNode.removeChild(style);
        return;
      }
      if (style) return;
      style = document.createElement('style');
      style.id = STYLE_ID;
      style.appendChild(document.createTextNode(CSS));
      (document.head || root).appendChild(style);
    } catch (e) {}
  }

  // Kurzer Befund aus dem Overlay-Dokument. Fremde Seiten lassen sich von aussen
  // nicht untersuchen, deshalb misst das Skript hier selbst nach und schickt das
  // Ergebnis mit - so laesst sich ein gemeldeter Rest-Hintergrund zuordnen, statt
  // ihn zu erraten.
  function survey() {
    try {
      var cs = window.getComputedStyle(document.documentElement);
      var bodyStyle = document.body ? window.getComputedStyle(document.body) : null;
      var nodes = document.body ? document.body.querySelectorAll('*') : [];
      var opaque = 0;
      var images = 0;
      for (var i = 0; i < nodes.length; i++) {
        var st = window.getComputedStyle(nodes[i]);
        var color = st.backgroundColor;
        if (color && color !== 'transparent' && !/rgba\([^)]*,\s*0\s*\)/.test(color)) opaque++;
        if (st.backgroundImage && st.backgroundImage !== 'none') images++;
      }
      return 'schema=' + (cs.colorScheme || '?') +
        ';html=' + (cs.backgroundColor || '?') +
        ';body=' + (bodyStyle ? bodyStyle.backgroundColor : '?') +
        ';flaechen=' + opaque + '/' + nodes.length +
        ';bilder=' + images +
        ';frueh=' + (appliedEarly ? 'ja' : 'nein') +
        ';name=' + (window.name || '-');
    } catch (e) { return 'befund nicht moeglich'; }
  }

  // Kurze Rueckmeldung an die Overlay-Seite, damit dort sichtbar ist, ob der
  // Schalter dieses Overlay wirklich erreicht hat.
  function report(on) {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({
          freakshowOverlay: 'background-ack',
          applied: on === true,
          survey: survey()
        }, '*');
      }
    } catch (e) {}
  }

  // Ton aus: Alle Medien im Dokument stummschalten. Ein Waechter erfasst auch das,
  // was die Seite spaeter nachlaedt - sonst kaeme bei der naechsten Meldung wieder Ton.
  var wantMuted = false;
  function applyMute() {
    try {
      var media = document.querySelectorAll('video, audio');
      for (var i = 0; i < media.length; i++) {
        if (media[i].muted !== wantMuted) media[i].muted = wantMuted;
        if (wantMuted) { try { media[i].volume = 0; } catch (e2) {} }
      }
    } catch (e) {}
  }
  window.setInterval(function () { if (wantMuted) applyMute(); }, 1000);

  window.addEventListener('message', function (event) {
    var data = event && event.data;
    if (data && typeof data === 'object' && data.freakshowOverlay === 'mute') {
      wantMuted = data.muted === true;
      applyMute();
      return;
    }
    if (!data || typeof data !== 'object' || data.freakshowOverlay !== 'background') return;
    wanted = data.transparent === true;
    apply(wanted);
    report(wanted);
    // Single-Page-Overlays bauen ihre Oberflaeche erst nach dem Laden auf. Ein
    // spaeterer Befund zeigt den Zustand, den der Zuschauer wirklich sieht.
    window.setTimeout(function () { report(wanted); }, 3000);
  }, false);

  // Der Wunsch steckt im Fensternamen, den die Overlay-Seite VOR dem Laden setzt.
  // Dadurch sitzt die Regel schon beim allerersten Bild. Wuerde erst auf die
  // Nachricht gewartet, waere bis dahin der dunkle Hintergrund der Seite zu sehen.
  try {
    if (String(window.name || '').indexOf('freakshow-overlay-nobg') >= 0) wanted = true;
  } catch (e) {}

  function applyWhenPossible() {
    if (wanted !== true) return true;
    if (!document.documentElement) return false;
    apply(true);
    if (document.getElementById(STYLE_ID)) {
      appliedEarly = true;
      return true;
    }
    return false;
  }

  if (!applyWhenPossible()) {
    // Beim allerersten Aufruf existiert der Dokumentbaum teilweise noch nicht.
    var earlyTimer = window.setInterval(function () {
      if (applyWhenPossible()) window.clearInterval(earlyTimer);
    }, 5);
    document.addEventListener('readystatechange', applyWhenPossible);
  }

  // Single-Page-Overlays bauen ihren Kopfbereich im Betrieb neu auf und werfen die
  // Regel dabei heraus. Ein Beobachter setzt sie im selben Moment zurueck - deshalb
  // kein Wecker im Sekundentakt, der genau dazwischen ein dunkles Aufblitzen liesse.
  document.addEventListener('DOMContentLoaded', function () { if (wanted !== null) apply(wanted); });

  function watchHead() {
    try {
      if (!window.MutationObserver || !document.head || window.__freakshowHeadWatch) return;
      window.__freakshowHeadWatch = new MutationObserver(function () {
        if (wanted === true && !document.getElementById(STYLE_ID)) apply(true);
      });
      window.__freakshowHeadWatch.observe(document.head, { childList: true });
    } catch (e) {}
  }

  if (!document.head) {
    var headTimer = window.setInterval(function () {
      if (document.head) { watchHead(); window.clearInterval(headTimer); }
    }, 10);
  } else {
    watchHead();
  }
})();
";

    private async System.Threading.Tasks.Task EnableOverlayBackgroundRemoval()
    {
        try
        {
            await web.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(OverlayBackgroundScript);
            HostLog.Write("Overlay background switch ready (web overlays can drop their background).");
        }
        catch (Exception ex)
        {
            HostLog.Write("Overlay background switch could not be enabled: " + ex.Message);
        }
    }

    // ===== Twitch-Widgets (Alert Box) im Overlay einbettbar machen =====
    // Twitch liefert dashboard.twitch.tv mit "X-Frame-Options: SAMEORIGIN" aus.
    // Das verbietet die Anzeige in einem iframe - in OBS faellt das nicht auf, weil
    // dort jede Browserquelle eine eigene Top-Level-Seite ist. Hier wird deshalb
    // NUR fuer diesen einen Host der Frame-Riegel aus der Antwort entfernt; die
    // Seite selbst laedt weiterhin direkt von Twitch (eigene Herkunft, eigener
    // Zugangs-Token im Link) und verhaelt sich damit exakt wie in OBS.
    private bool twitchFrameHeaderRemoved;
    private int twitchDiagnosticsLogged;

    // Liest die frameLock-Hosts aus der eingebetteten Anbieter-Tabelle. Faellt bei
    // fehlender oder kaputter Tabelle auf die bekannten zwei Hosts zurueck, damit
    // Twitch-Alertbox und Voicemod nie versehentlich brechen.
    private static List<string> LoadFrameLockHosts()
    {
        List<string> hosts = new List<string>();
        try
        {
            using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("FreakShow.App.overlay-providers.json"))
            {
                if (stream != null)
                {
                    using (StreamReader reader = new StreamReader(stream, Encoding.UTF8))
                    {
                        JavaScriptSerializer serializer = new JavaScriptSerializer();
                        Dictionary<string, object> table = serializer.Deserialize<Dictionary<string, object>>(reader.ReadToEnd());
                        object providersValue;
                        if (table != null && table.TryGetValue("providers", out providersValue))
                        {
                            IEnumerable providerList = providersValue as IEnumerable;
                            if (providerList != null)
                            {
                                foreach (object entry in providerList)
                                {
                                    Dictionary<string, object> provider = entry as Dictionary<string, object>;
                                    if (provider == null) continue;
                                    object lockValue;
                                    object hostValue;
                                    bool locked = provider.TryGetValue("frameLock", out lockValue) && lockValue is bool && (bool)lockValue;
                                    if (!locked || !provider.TryGetValue("host", out hostValue)) continue;
                                    string host = Convert.ToString(hostValue);
                                    if (!String.IsNullOrEmpty(host) && Regex.IsMatch(host, "^[a-z0-9.-]+$") && !hosts.Contains(host))
                                    {
                                        hosts.Add(host);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        catch (Exception ex)
        {
            HostLog.Write("Provider table could not be read; using built-in frame lock hosts: " + ex.Message);
        }
        if (hosts.Count == 0)
        {
            hosts.Add("dashboard.twitch.tv");
            hosts.Add("overlay.voicemod.net");
        }
        return hosts;
    }

    private async System.Threading.Tasks.Task EnableTwitchWidgetEmbedding()
    {
        try
        {
            web.CoreWebView2.GetDevToolsProtocolEventReceiver("Fetch.requestPaused").DevToolsProtocolEventReceived += OnTwitchResponsePaused;
            // Welche Hosts ihren Einbettungs-Riegel verlieren, steht in der zentralen
            // Anbieter-Tabelle (app/overlay-providers.json, frameLock=true). Ein neuer
            // Anbieter braucht also nur einen Tabelleneintrag, keinen Code hier.
            List<string> frameLockHosts = LoadFrameLockHosts();
            StringBuilder patterns = new StringBuilder("{\"patterns\":[");
            for (int i = 0; i < frameLockHosts.Count; i++)
            {
                if (i > 0) patterns.Append(',');
                patterns.Append("{\"urlPattern\":\"https://").Append(frameLockHosts[i]).Append("/*\",\"requestStage\":\"Response\"}");
            }
            patterns.Append("]}");
            await web.CoreWebView2.CallDevToolsProtocolMethodAsync("Fetch.enable", patterns.ToString());
            HostLog.Write("Overlay embedding enabled (frame headers relaxed for " + String.Join(", ", frameLockHosts.ToArray()) + ").");
        }
        catch (Exception ex)
        {
            HostLog.Write("Twitch widget embedding could not be enabled: " + ex.Message);
        }
    }

    private async void OnTwitchResponsePaused(object sender, CoreWebView2DevToolsProtocolEventReceivedEventArgs e)
    {
        string requestId = null;
        bool needsPlainContinue = false;
        try
        {
            JavaScriptSerializer serializer = new JavaScriptSerializer();
            Dictionary<string, object> data = serializer.Deserialize<Dictionary<string, object>>(e.ParameterObjectAsJson);
            object idValue;
            if (data == null || !data.TryGetValue("requestId", out idValue)) return;
            requestId = Convert.ToString(idValue);

            object statusValue;
            int statusCode = 0;
            if (data.TryGetValue("responseStatusCode", out statusValue) && statusValue != null)
            {
                Int32.TryParse(Convert.ToString(statusValue), out statusCode);
            }
            // NUR die HTML-Seite selbst anfassen. Wuerde man auch die internen
            // API-Antworten (JSON) neu zusammensetzen, verloeren sie Header und die
            // Alertbox bliebe leer. Alles andere laeuft unveraendert weiter.
            bool isHtml = false;
            object headersProbe;
            if (data.TryGetValue("responseHeaders", out headersProbe))
            {
                IEnumerable probeList = headersProbe as IEnumerable;
                if (probeList != null)
                {
                    foreach (object entry in probeList)
                    {
                        Dictionary<string, object> header = entry as Dictionary<string, object>;
                        if (header == null) continue;
                        object n, v;
                        header.TryGetValue("name", out n);
                        header.TryGetValue("value", out v);
                        if (String.Equals(Convert.ToString(n), "content-type", StringComparison.OrdinalIgnoreCase) &&
                            Convert.ToString(v).IndexOf("text/html", StringComparison.OrdinalIgnoreCase) >= 0)
                        {
                            isHtml = true;
                            break;
                        }
                    }
                }
            }
            // Diagnose: die ersten Antworten dieses Hosts protokollieren, damit im
            // Log nachvollziehbar ist, was abgefangen wird (max. 5 Zeilen).
            if (twitchDiagnosticsLogged < 5)
            {
                twitchDiagnosticsLogged++;
                object urlValue, typeProbe;
                Dictionary<string, object> requestObject = null;
                if (data.TryGetValue("request", out urlValue)) requestObject = urlValue as Dictionary<string, object>;
                object innerUrl = null;
                if (requestObject != null) requestObject.TryGetValue("url", out innerUrl);
                data.TryGetValue("resourceType", out typeProbe);
                string shownUrl = Convert.ToString(innerUrl);
                if (shownUrl.Length > 90) shownUrl = shownUrl.Substring(0, 90) + "…";
                HostLog.Write("Twitch response seen: type=" + Convert.ToString(typeProbe) + " status=" + statusCode + " html=" + isHtml + " url=" + shownUrl);
            }
            // Ohne gueltigen Status (reine Anfrage-Phase, Weiterleitung, Fehlschlag)
            // laesst sich keine Antwort ersetzen -> unveraendert weiterreichen.
            if (!isHtml || statusCode < 100 || statusCode > 599)
            {
                needsPlainContinue = true;
            }
            else
            {

            List<object> keptHeaders = new List<object>();
            object headersValue;
            if (data.TryGetValue("responseHeaders", out headersValue))
            {
                IEnumerable headers = headersValue as IEnumerable;
                if (headers != null)
                {
                    foreach (object entry in headers)
                    {
                        Dictionary<string, object> header = entry as Dictionary<string, object>;
                        if (header == null) continue;
                        object nameValue, valueValue;
                        header.TryGetValue("name", out nameValue);
                        header.TryGetValue("value", out valueValue);
                        string name = Convert.ToString(nameValue);
                        string value = Convert.ToString(valueValue);
                        if (String.IsNullOrEmpty(name)) continue;
                        if (name.Equals("x-frame-options", StringComparison.OrdinalIgnoreCase))
                        {
                            // Einmalig bestaetigen, dass der Riegel wirklich faellt.
                            if (!twitchFrameHeaderRemoved)
                            {
                                twitchFrameHeaderRemoved = true;
                                HostLog.Write("Twitch frame lock removed (X-Frame-Options stripped) - widget can now render in the overlay.");
                            }
                            continue;
                        }
                        if (name.Equals("content-security-policy", StringComparison.OrdinalIgnoreCase))
                        {
                            value = StripFrameAncestors(value);
                            if (String.IsNullOrWhiteSpace(value)) continue;
                        }
                        // Die Antwort wird gleich mit dem bereits entpackten Text neu
                        // ausgeliefert. Packungs- und Laengenangaben der Originalantwort
                        // wuerden dann nicht mehr passen und die Seite abbrechen lassen.
                        if (name.Equals("content-encoding", StringComparison.OrdinalIgnoreCase)) continue;
                        if (name.Equals("content-length", StringComparison.OrdinalIgnoreCase)) continue;
                        // Mehrzeilige Werte (z. B. mehrere Set-Cookie) wuerden das
                        // Antwort-Format sprengen -> in eine Zeile zusammenfuehren.
                        value = (value ?? "").Replace("\r", "").Replace("\n", " ");
                        keptHeaders.Add(new Dictionary<string, object> { { "name", name }, { "value", value } });
                    }
                }
            }

                // Den fertigen Seitentext holen und die Antwort komplett selbst
                // ausliefern. Nur Header zu tauschen reicht nicht: der Original-Body
                // ist gepackt, wodurch die Anfrage nach dem Umschreiben abbricht.
                string idOnly = serializer.Serialize(new Dictionary<string, object> { { "requestId", requestId } });
                string bodyResult = await web.CoreWebView2.CallDevToolsProtocolMethodAsync("Fetch.getResponseBody", idOnly);
                Dictionary<string, object> bodyData = serializer.Deserialize<Dictionary<string, object>>(bodyResult);
                object rawBody, encodedFlag;
                bodyData.TryGetValue("body", out rawBody);
                bodyData.TryGetValue("base64Encoded", out encodedFlag);
                string bodyText = Convert.ToString(rawBody);
                bool alreadyBase64 = (encodedFlag != null) && Convert.ToBoolean(encodedFlag);
                if (!alreadyBase64) bodyText = Convert.ToBase64String(Encoding.UTF8.GetBytes(bodyText));

                Dictionary<string, object> payload = new Dictionary<string, object>();
                payload["requestId"] = requestId;
                payload["responseCode"] = statusCode;
                payload["responseHeaders"] = keptHeaders;
                payload["body"] = bodyText;
                await web.CoreWebView2.CallDevToolsProtocolMethodAsync("Fetch.fulfillRequest", serializer.Serialize(payload));
            }
        }
        catch (Exception ex)
        {
            HostLog.Write("Twitch response could not be adjusted: " + ex.Message);
            // Die Antwort MUSS weiterlaufen, sonst haengt die eingebettete Seite.
            // (await ist in einer catch-Klausel nicht erlaubt -> Merker setzen.)
            needsPlainContinue = !String.IsNullOrEmpty(requestId);
        }

        if (needsPlainContinue)
        {
            // In der Antwort-Phase reicht continueResponse OHNE Header die Antwort
            // unveraendert weiter; continueRequest ist hier der Notnagel.
            string idJson = "{\"requestId\":\"" + requestId.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"}";
            // Kein await in einer catch-Klausel (alter C#-Compiler) -> Merker.
            bool continueResponseFailed = false;
            try
            {
                await web.CoreWebView2.CallDevToolsProtocolMethodAsync("Fetch.continueResponse", idJson);
            }
            catch
            {
                continueResponseFailed = true;
            }
            if (continueResponseFailed)
            {
                try { await web.CoreWebView2.CallDevToolsProtocolMethodAsync("Fetch.continueRequest", idJson); }
                catch { }
            }
        }
    }

    // Nur die Frame-Sperre aus einer CSP entfernen; alle anderen Schutzregeln bleiben.
    private static string StripFrameAncestors(string policy)
    {
        if (String.IsNullOrEmpty(policy)) return policy;
        string[] directives = policy.Split(';');
        List<string> kept = new List<string>();
        for (int i = 0; i < directives.Length; i++)
        {
            string directive = directives[i].Trim();
            if (directive.Length == 0) continue;
            if (directive.StartsWith("frame-ancestors", StringComparison.OrdinalIgnoreCase)) continue;
            kept.Add(directive);
        }
        return String.Join("; ", kept.ToArray());
    }

    private static async System.Threading.Tasks.Task WaitForBridge()
    {
        for (int i = 0; i < 40; i++)
        {
            try
            {
                HttpWebRequest request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:18081/health?t=" + DateTime.UtcNow.Ticks);
                request.Timeout = 500;
                request.ReadWriteTimeout = 500;
                using (HttpWebResponse response = (HttpWebResponse)await request.GetResponseAsync())
                {
                    if ((int)response.StatusCode == 200) return;
                }
            }
            catch { }
            await System.Threading.Tasks.Task.Delay(150);
        }
        throw new InvalidOperationException("Die eingebettete Bridge konnte Port 18081 nicht bereitstellen. Läuft die alte Bridge noch?");
    }

    // Windows kann Autostart-Programme starten, bevor die Netzwerkkarte bereits
    // eine Route zum Streamer.bot-PC besitzt. In diesem kurzen Fenster erzeugte
    // WebSockets koennen in WebView2 haengen bleiben. Die Bridge und Einstellungen
    // laufen sofort; nur die erste Overlay-Navigation wartet maximal 25 Sekunden.
    private static async System.Threading.Tasks.Task WaitForStreamerBotEndpoint()
    {
        string host = null;
        int port = 0;
        try
        {
            string file = Path.Combine(Path.GetDirectoryName(Application.ExecutablePath), "data", "config", "websocket-config.json");
            if (!File.Exists(file)) return;
            string json = File.ReadAllText(file);
            Match mh = Regex.Match(json, "\\\"host\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"", RegexOptions.IgnoreCase);
            Match mp = Regex.Match(json, "\\\"port\\\"\\s*:\\s*(\\d+)", RegexOptions.IgnoreCase);
            if (!mh.Success || !mp.Success || !Int32.TryParse(mp.Groups[1].Value, out port) || port < 1 || port > 65535) return;
            host = mh.Groups[1].Value.Trim();
            if (String.IsNullOrWhiteSpace(host)) return;
        }
        catch (Exception ex)
        {
            HostLog.Write("Streamer.bot startup endpoint config could not be read: " + ex.Message);
            return;
        }

        for (int attempt = 0; attempt < 50; attempt++)
        {
            if (await CanConnectTcpAsync(host, port, 450))
            {
                HostLog.Write("Streamer.bot endpoint reachable; starting overlay navigation.");
                return;
            }
            await System.Threading.Tasks.Task.Delay(500);
        }
        HostLog.Write("Streamer.bot endpoint not reachable after startup wait; loading overlay with reconnect protection.");
    }

    private static async System.Threading.Tasks.Task<bool> CanConnectTcpAsync(string host, int port, int timeoutMs)
    {
        using (TcpClient client = new TcpClient())
        {
            try
            {
                System.Threading.Tasks.Task connect = client.ConnectAsync(host, port);
                System.Threading.Tasks.Task finished = await System.Threading.Tasks.Task.WhenAny(connect, System.Threading.Tasks.Task.Delay(timeoutMs));
                if (finished != connect)
                {
                    try { client.Close(); } catch { }
                    System.Threading.Tasks.Task observeFailure = connect.ContinueWith(
                        delegate(System.Threading.Tasks.Task t) { var ignored = t.Exception; },
                        System.Threading.Tasks.TaskContinuationOptions.OnlyOnFaulted);
                    return false;
                }
                await connect;
                return client.Connected;
            }
            catch { return false; }
        }
    }

    private async System.Threading.Tasks.Task CheckStreamerBotStartupAsync()
    {
        if (sbStatusCheckInFlight || sbStartupWatchStarted == DateTime.MinValue || web.CoreWebView2 == null) return;
        sbStatusCheckInFlight = true;
        try
        {
            if (await ReadHostStreamerBotStatusAsync())
            {
                sbStartupTimer.Stop();
                HostLog.Write("Streamer.bot startup connection confirmed.");
                return;
            }

            double elapsed = (DateTime.UtcNow - sbStartupWatchStarted).TotalSeconds;
            int[] reloadAtSeconds = new int[] { 20, 50, 90 };
            if (sbStartupReloads < reloadAtSeconds.Length &&
                elapsed >= reloadAtSeconds[sbStartupReloads] &&
                (lastSbStartupReload == DateTime.MinValue || (DateTime.UtcNow - lastSbStartupReload).TotalSeconds >= 15))
            {
                sbStartupReloads++;
                lastSbStartupReload = DateTime.UtcNow;
                HostLog.Write("Streamer.bot still disconnected during startup; reloading overlay page (attempt " + sbStartupReloads + "/3).");
                try { web.Reload(); } catch (Exception ex) { HostLog.Write("Startup overlay reload failed: " + ex.Message); }
            }

            if (elapsed >= 180 && sbStartupReloads >= reloadAtSeconds.Length)
            {
                sbStartupTimer.Stop();
                HostLog.Write("Streamer.bot startup watch ended after 3 overlay reloads; normal client reconnect remains active.");
            }
        }
        catch (Exception ex)
        {
            HostLog.Write("Streamer.bot startup status check failed: " + ex.Message);
        }
        finally
        {
            sbStatusCheckInFlight = false;
        }
    }

    private static async System.Threading.Tasks.Task<bool> ReadHostStreamerBotStatusAsync()
    {
        try
        {
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:18081/host-status?t=" + DateTime.UtcNow.Ticks);
            request.Timeout = 1000;
            request.ReadWriteTimeout = 1000;
            request.KeepAlive = false;
            request.Proxy = null;
            using (HttpWebResponse response = (HttpWebResponse)await request.GetResponseAsync())
            using (StreamReader reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
            {
                string json = await reader.ReadToEndAsync();
                return Regex.IsMatch(json, "\\\"overlayRunning\\\"\\s*:\\s*true", RegexOptions.IgnoreCase) &&
                       Regex.IsMatch(json, "\\\"sbConnected\\\"\\s*:\\s*true", RegexOptions.IgnoreCase);
            }
        }
        catch { return false; }
    }

    private int ReadMonitorIndex()
    {
        try
        {
            string file = Path.Combine(Path.GetDirectoryName(Application.ExecutablePath), "data", "config", "overlay-monitor.json");
            if (!File.Exists(file)) return 0;
            Match m = Regex.Match(File.ReadAllText(file), "\\\"index\\\"\\s*:\\s*(-?\\d+)", RegexOptions.IgnoreCase);
            int value;
            if (m.Success && Int32.TryParse(m.Groups[1].Value, out value)) return value;
        }
        catch { }
        return 0;
    }

    private void ApplySelectedMonitor()
    {
        int index = ReadMonitorIndex();
        Screen[] screens = Screen.AllScreens;
        if (screens.Length == 0) return;
        if (index < 0 || index >= screens.Length) index = 0;
        bool changed = index != lastMonitor || Bounds != screens[index].Bounds;
        if (changed)
        {
            lastMonitor = index;
            Bounds = screens[index].Bounds;
            EnsureTopMost("monitor");
            HostLog.Write("Overlay moved to monitor " + index + " (" + Bounds.Width + "x" + Bounds.Height + ").");
        }
        if (overlayNavigationReady)
        {
            if (changed) NavigatePrimaryOverlay(index);
            SyncSatelliteForms(index);
        }
    }

    internal static Uri BuildOverlayUri(int localMonitor, int primaryMonitor, bool satellite)
    {
        string url = "http://127.0.0.1:18081/content/index.html?localMonitor=" + localMonitor + "&primaryMonitor=" + primaryMonitor;
        if (satellite) url += "&satellite=1&instanceGuard=0";
        return new Uri(url);
    }

    private void NavigatePrimaryOverlay(int monitorIndex)
    {
        if (web == null || web.CoreWebView2 == null) return;
        Uri target = BuildOverlayUri(monitorIndex, monitorIndex, false);
        if (web.Source == null || !String.Equals(web.Source.AbsoluteUri, target.AbsoluteUri, StringComparison.OrdinalIgnoreCase))
        {
            web.Source = target;
            HostLog.Write("Primary overlay routing set to monitor " + monitorIndex + ".");
        }
    }

    private void SyncSatelliteForms(int primaryMonitor)
    {
        Screen[] screens = Screen.AllScreens;
        HashSet<int> desired = new HashSet<int>();
        for (int i = 0; i < screens.Length; i++)
        {
            if (i == primaryMonitor) continue;
            desired.Add(i);
            OverlaySatelliteForm satellite;
            if (!satelliteForms.TryGetValue(i, out satellite) || satellite.IsDisposed)
            {
                satellite = new OverlaySatelliteForm(contentRoot, i, primaryMonitor);
                satelliteForms[i] = satellite;
                satellite.Show();
                HostLog.Write("Satellite overlay opened on monitor " + i + ".");
            }
            else
            {
                satellite.Refresh(primaryMonitor);
            }
        }

        List<int> close = new List<int>();
        foreach (KeyValuePair<int, OverlaySatelliteForm> pair in satelliteForms)
        {
            if (!desired.Contains(pair.Key)) close.Add(pair.Key);
        }
        for (int j = 0; j < close.Count; j++)
        {
            OverlaySatelliteForm satellite;
            if (satelliteForms.TryGetValue(close[j], out satellite))
            {
                try { satellite.Close(); } catch { }
                try { satellite.Dispose(); } catch { }
            }
            satelliteForms.Remove(close[j]);
            HostLog.Write("Satellite overlay closed on monitor " + close[j] + ".");
        }
    }

    private void CloseSatelliteForms()
    {
        foreach (KeyValuePair<int, OverlaySatelliteForm> pair in satelliteForms)
        {
            try { pair.Value.Close(); } catch { }
            try { pair.Value.Dispose(); } catch { }
        }
        satelliteForms.Clear();
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        lastHotkeyRaw = null;                 // nach (Neu-)Erzeugung des Fensters neu registrieren
        try { SyncHotkeyRegistration(); } catch { }
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_HOTKEY && m.WParam.ToInt32() == HOTKEY_ID) { ToggleOverlayOutput(); }
        base.WndProc(ref m);
    }

    // Liest data/config/pause-hotkey.json und (de)registriert den globalen Hotkey NUR bei Aenderung.
    // Wird beim Start (OnHandleCreated) und danach im monitorTimer (alle 1,5s) aufgerufen.
    private void SyncHotkeyRegistration()
    {
        if (!IsHandleCreated) return;
        string raw = "";
        try
        {
            string f = Path.Combine(Path.GetDirectoryName(Application.ExecutablePath), "data", "config", "pause-hotkey.json");
            if (File.Exists(f)) raw = File.ReadAllText(f);
        }
        catch { }
        if (raw == lastHotkeyRaw) return;
        lastHotkeyRaw = raw;

        int vk = 0; uint mods = 0;
        try
        {
            Match mv = Regex.Match(raw, "\\\"vk\\\"\\s*:\\s*(\\d+)");
            if (mv.Success) Int32.TryParse(mv.Groups[1].Value, out vk);
            if (Regex.IsMatch(raw, "\\\"ctrl\\\"\\s*:\\s*true", RegexOptions.IgnoreCase)) mods |= MOD_CONTROL;
            if (Regex.IsMatch(raw, "\\\"alt\\\"\\s*:\\s*true", RegexOptions.IgnoreCase)) mods |= MOD_ALT;
            if (Regex.IsMatch(raw, "\\\"shift\\\"\\s*:\\s*true", RegexOptions.IgnoreCase)) mods |= MOD_SHIFT;
        }
        catch { }

        try { UnregisterHotKey(Handle, HOTKEY_ID); } catch { }
        if (vk > 0 && vk <= 255)
        {
            bool ok = false;
            try { ok = RegisterHotKey(Handle, HOTKEY_ID, mods | MOD_NOREPEAT, (uint)vk); } catch { }
            HostLog.Write("Global hotkey " + (ok ? "registered" : "FAILED (already used by another app?)") + " vk=" + vk + " mods=" + mods);
        }
        else
        {
            HostLog.Write("Global hotkey cleared (no key set).");
        }
    }

    // Schaltet die Overlay-Ausgabe um (data/state/overlay-output.json) - identisch zum UI-Schalter.
    private void ToggleOverlayOutput()
    {
        try
        {
            string file = Path.Combine(Path.GetDirectoryName(Application.ExecutablePath), "data", "state", "overlay-output.json");
            bool enabled = true;   // Standard: Ausgabe an (wie in der Bridge)
            try { if (File.Exists(file)) enabled = !Regex.IsMatch(File.ReadAllText(file), "\\\"enabled\\\"\\s*:\\s*false", RegexOptions.IgnoreCase); } catch { }
            bool next = !enabled;
            string dir = Path.GetDirectoryName(file);
            if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);
            File.WriteAllText(file, "{\"enabled\":" + (next ? "true" : "false") + "}");
            HostLog.Write("Global hotkey toggled overlay output -> " + (next ? "ON" : "OFF"));
        }
        catch (Exception ex) { HostLog.Write("Hotkey toggle failed: " + ex.Message); }
    }

    private static void OpenSettings()
    {
        try { Process.Start("http://127.0.0.1:18081/"); }
        catch (Exception ex) { HostLog.Write("Could not open settings: " + ex.Message); }
    }

    private async System.Threading.Tasks.Task CheckForUpdatesAsync(bool manual)
    {
        if (updateCheckInFlight) return;
        updateCheckInFlight = true;
        if (updateMenuItem != null)
        {
            updateMenuItem.Enabled = false;
            updateMenuItem.Text = UpdateText.Checking;
        }

        try
        {
            UpdateManifest manifest = await UpdateService.CheckAsync();
            availableUpdate = manifest;
            if (manifest == null)
            {
                if (updateMenuItem != null) updateMenuItem.Text = UpdateText.CheckForUpdates;
                if (manual) MessageBox.Show(UpdateText.CurrentBody, UpdateText.CurrentTitle, MessageBoxButtons.OK, MessageBoxIcon.Information);
                HostLog.Write("Update check completed: current version is up to date.");
            }
            else
            {
                if (updateMenuItem != null) updateMenuItem.Text = UpdateText.InstallVersion(manifest.version);
                HostLog.Write("Update available: " + manifest.version + ".");
                if (manual)
                {
                    await PromptAndInstallUpdateAsync();
                }
                else if (!String.Equals(notifiedUpdateVersion, manifest.version, StringComparison.OrdinalIgnoreCase) && tray != null)
                {
                    notifiedUpdateVersion = manifest.version;
                    tray.ShowBalloonTip(9000, UpdateText.UpdateAvailableTitle, UpdateText.UpdateAvailableBody(manifest.version), ToolTipIcon.Info);
                }
            }
        }
        catch (Exception ex)
        {
            HostLog.Write("Update check failed: " + ex);
            if (updateMenuItem != null) updateMenuItem.Text = UpdateText.CheckForUpdates;
            if (manual) MessageBox.Show(UpdateText.CheckFailed + "\n\n" + ex.Message, "FreakShow", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
        finally
        {
            updateCheckInFlight = false;
            if (updateMenuItem != null) updateMenuItem.Enabled = true;
        }
    }

    private async System.Threading.Tasks.Task PromptAndInstallUpdateAsync()
    {
        UpdateManifest manifest = availableUpdate;
        if (manifest == null) return;
        DialogResult answer = MessageBox.Show(UpdateText.InstallQuestion(manifest.version), UpdateText.UpdateAvailableTitle, MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2);
        if (answer != DialogResult.Yes) return;

        try
        {
            if (updateMenuItem != null)
            {
                updateMenuItem.Enabled = false;
                updateMenuItem.Text = UpdateText.Downloading(manifest.version);
            }
            string baseDir = Path.GetDirectoryName(Application.ExecutablePath);
            HostLog.Write("Downloading update " + manifest.version + ".");
            string package = await UpdateService.DownloadPackageAsync(manifest, baseDir);
            UpdateService.LaunchUpdater(package, manifest, baseDir);
            Application.Exit();
        }
        catch (Exception ex)
        {
            HostLog.Write("Update install preparation failed: " + ex);
            MessageBox.Show(UpdateText.InstallFailed + "\n\n" + ex.Message, "FreakShow", MessageBoxButtons.OK, MessageBoxIcon.Error);
            if (updateMenuItem != null)
            {
                updateMenuItem.Enabled = true;
                updateMenuItem.Text = UpdateText.InstallVersion(manifest.version);
            }
        }
    }

    private void CreateTray()
    {
        tray = new NotifyIcon();
        try
        {
            string ico = Path.Combine(Path.GetDirectoryName(Application.ExecutablePath), "OverlayIcon.ico");
            tray.Icon = File.Exists(ico) ? new Icon(ico) : Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        }
        catch { tray.Icon = SystemIcons.Application; }
        tray.Text = "FreakShow " + FreakShowVersion.Current;
        ContextMenuStrip menu = new ContextMenuStrip();
        ToolStripMenuItem settings = new ToolStripMenuItem(UpdateText.OpenSettings);
        settings.Click += delegate { OpenSettings(); };
        ToolStripMenuItem visibility = new ToolStripMenuItem(UpdateText.ToggleOverlay);
        visibility.Click += delegate
        {
            Visible = !Visible;
            if (Visible) EnsureTopMost("tray");
        };
        updateMenuItem = new ToolStripMenuItem(UpdateText.CheckForUpdates);
        updateMenuItem.Click += async delegate
        {
            if (availableUpdate != null) await PromptAndInstallUpdateAsync();
            else await CheckForUpdatesAsync(true);
        };
        ToolStripMenuItem exit = new ToolStripMenuItem(UpdateText.Exit);
        exit.Click += delegate { Application.Exit(); };
        menu.Items.Add(settings);
        menu.Items.Add(visibility);
        menu.Items.Add(updateMenuItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(exit);
        tray.ContextMenuStrip = menu;
        tray.DoubleClick += delegate { OpenSettings(); };
        tray.Visible = true;
    }
}

// Schlankes, click-through Ausgabefenster für einen weiteren physischen Monitor.
// Die URL trägt den Monitorindex; index.html zeigt dort ausschließlich gezielt
// zugewiesene Notizen und Web-Overlays. Dadurch bleibt der Hauptmonitor unverändert.
internal sealed class OverlaySatelliteForm : Form
{
    private const int WS_EX_TRANSPARENT = 0x20;
    private const int WS_EX_TOOLWINDOW = 0x80;
    private const int WS_EX_TOPMOST = 0x8;
    private const int WS_EX_LAYERED = 0x80000;
    private const int WS_EX_NOACTIVATE = 0x08000000;
    private const int GWL_EXSTYLE = -20;
    private const uint SWP_NOSIZE = 0x0001;
    private const uint SWP_NOMOVE = 0x0002;
    private const uint SWP_NOACTIVATE = 0x0010;
    private const uint SWP_NOOWNERZORDER = 0x0200;
    private const uint SWP_NOSENDCHANGING = 0x0400;
    private static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint flags);

    private readonly string contentRoot;
    private readonly int monitorIndex;
    private readonly WebView2 web;
    private readonly System.Windows.Forms.Timer refreshTimer;
    private int primaryMonitor;
    private bool initialized;

    public OverlaySatelliteForm(string contentRoot, int monitorIndex, int primaryMonitor)
    {
        this.contentRoot = contentRoot;
        this.monitorIndex = monitorIndex;
        this.primaryMonitor = primaryMonitor;
        Text = "FreakShow – Zusatzmonitor " + (monitorIndex + 1);
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.Manual;
        TopMost = true;
        ShowInTaskbar = false;
        BackColor = Color.Magenta;
        TransparencyKey = Color.Magenta;
        DoubleBuffered = true;
        ApplyScreenBounds();

        web = new WebView2();
        web.Dock = DockStyle.Fill;
        web.DefaultBackgroundColor = Color.Transparent;
        Controls.Add(web);

        refreshTimer = new System.Windows.Forms.Timer();
        refreshTimer.Interval = 1500;
        refreshTimer.Tick += delegate { ApplyScreenBounds(); EnsureTopMost(); };
        Load += delegate { InitializeAsync(); };
        FormClosed += delegate { try { refreshTimer.Stop(); } catch { } };
    }

    protected override CreateParams CreateParams
    {
        get
        {
            CreateParams cp = base.CreateParams;
            cp.ExStyle |= WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_TOPMOST | WS_EX_LAYERED | WS_EX_NOACTIVATE;
            return cp;
        }
    }

    protected override bool ShowWithoutActivation { get { return true; } }

    protected override void OnShown(EventArgs e)
    {
        base.OnShown(e);
        EnsureTopMost();
    }

    internal void Refresh(int newPrimaryMonitor)
    {
        primaryMonitor = newPrimaryMonitor;
        ApplyScreenBounds();
        EnsureTopMost();
        NavigateIfReady();
    }

    private void ApplyScreenBounds()
    {
        Screen[] screens = Screen.AllScreens;
        if (monitorIndex < 0 || monitorIndex >= screens.Length) return;
        if (Bounds != screens[monitorIndex].Bounds) Bounds = screens[monitorIndex].Bounds;
    }

    private async void InitializeAsync()
    {
        try
        {
            string baseDir = Path.GetDirectoryName(Application.ExecutablePath);
            string data = Path.Combine(baseDir, "WebView2Satellite-" + monitorIndex);
            CoreWebView2EnvironmentOptions options = new CoreWebView2EnvironmentOptions("--disable-http-cache --disk-cache-size=1 --autoplay-policy=no-user-gesture-required");
            CoreWebView2Environment environment = await CoreWebView2Environment.CreateAsync(null, data, options);
            await web.EnsureCoreWebView2Async(environment);
            web.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
            web.CoreWebView2.Settings.AreDevToolsEnabled = false;
            web.CoreWebView2.Settings.IsStatusBarEnabled = false;
            web.CoreWebView2.Settings.IsZoomControlEnabled = false;
            web.CoreWebView2.PermissionRequested += delegate(object sender, CoreWebView2PermissionRequestedEventArgs e) { e.State = CoreWebView2PermissionState.Allow; };
            web.CoreWebView2.ProcessFailed += delegate { try { web.Reload(); } catch { } };
            await web.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(OverlayForm.OverlayBackgroundScript);
            initialized = true;
            NavigateIfReady();
            refreshTimer.Start();
            HostLog.Write("Satellite overlay ready on monitor " + monitorIndex + ".");
        }
        catch (Exception ex)
        {
            HostLog.Write("Satellite overlay initialization failed on monitor " + monitorIndex + ": " + ex.Message);
            try { Close(); } catch { }
        }
    }

    private void NavigateIfReady()
    {
        if (!initialized || web.CoreWebView2 == null) return;
        Uri target = OverlayForm.BuildOverlayUri(monitorIndex, primaryMonitor, true);
        if (web.Source == null || !String.Equals(web.Source.AbsoluteUri, target.AbsoluteUri, StringComparison.OrdinalIgnoreCase)) web.Source = target;
    }

    private void EnsureTopMost()
    {
        if (IsDisposed || Disposing || !IsHandleCreated || !Visible) return;
        try
        {
            SetWindowPos(Handle, HWND_TOPMOST, 0, 0, 0, 0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_NOSENDCHANGING);
        }
        catch { }
    }
}

internal static class Program
{
    private const string HtmlOverlayReadmeResource = "FreakShow.HtmlOverlays.Readme";
    private const string HtmlOverlayLinkTemplateResource = "FreakShow.HtmlOverlays.LinkTemplate";
    private static Mutex mutex;
    private static EmbeddedBridge bridge;

    [STAThread]
    private static void Main(string[] args)
    {
        bool created;
        mutex = new Mutex(true, "Local\\FreakShow.SingleInstance", out created);
        if (!created)
        {
            try { Process.Start("http://127.0.0.1:18081/"); } catch { }
            return;
        }

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
        string baseDir = Path.GetDirectoryName(Application.ExecutablePath);
        UpdateText.Initialize(baseDir);
        string logsDir = Path.Combine(baseDir, "Logs");
        Directory.CreateDirectory(logsDir);
        HostLog.FilePath = Path.Combine(logsDir, "FreakShow.log");
        UpdateService.CleanupArtifacts(baseDir);
        UpdateService.ScheduleCleanup(baseDir);
        Application.ThreadException += delegate(object sender, ThreadExceptionEventArgs e) { HostLog.Write("UI ERROR: " + e.Exception); };
        AppDomain.CurrentDomain.UnhandledException += delegate(object sender, UnhandledExceptionEventArgs e) { HostLog.Write("FATAL: " + e.ExceptionObject); };

        string contentRoot = ResolveContentRoot(args, baseDir);
        if (String.IsNullOrEmpty(contentRoot))
        {
            MessageBox.Show("Kein gültiger Content-Ordner gefunden.\nBitte FreakShow.config.json prüfen.", "FreakShow", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }
        try
        {
            EnsureHtmlOverlayFolder(contentRoot);
        }
        catch (Exception ex)
        {
            HostLog.Write("Content folder preparation failed: " + ex.Message);
            MessageBox.Show("Der Content-Ordner konnte nicht vorbereitet werden.\n\n" + ex.Message, "FreakShow", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        string appDir;
        try { appDir = EmbeddedRuntime.Prepare(); }
        catch (Exception ex)
        {
            HostLog.Write("Embedded runtime preparation failed: " + ex);
            MessageBox.Show("Die eingebettete FreakShow-Oberfläche konnte nicht gestartet werden.\n\n" + ex.Message, "FreakShow", MessageBoxButtons.OK, MessageBoxIcon.Error);
            EmbeddedRuntime.Cleanup();
            return;
        }

        HostLog.Write("Host starting. ContentRoot=" + contentRoot);
        bridge = new EmbeddedBridge(contentRoot, Application.ExecutablePath, appDir);
        bridge.Start();
        try { Application.Run(new OverlayForm(contentRoot)); }
        finally
        {
            if (bridge != null) bridge.Dispose();
            EmbeddedRuntime.Cleanup();
            if (mutex != null) { try { mutex.ReleaseMutex(); } catch { } mutex.Dispose(); }
            HostLog.Write("Host stopped.");
        }
    }

    private static string ResolveContentRoot(string[] args, string baseDir)
    {
        for (int i = 0; i < args.Length - 1; i++)
        {
            if (String.Equals(args[i], "--content-root", StringComparison.OrdinalIgnoreCase)) return Normalize(args[i + 1], baseDir);
        }
        string env = Environment.GetEnvironmentVariable("FREAKSHOW_CONTENT_ROOT");
        if (!String.IsNullOrWhiteSpace(env)) return Normalize(env, baseDir);
        string config = Path.Combine(baseDir, "FreakShow.config.json");
        try
        {
            if (File.Exists(config))
            {
                Match m = Regex.Match(File.ReadAllText(config), "\\\"ContentRoot\\\"\\s*:\\s*\\\"((?:\\\\.|[^\\\"])*)\\\"", RegexOptions.IgnoreCase);
                if (m.Success)
                {
                    string value = m.Groups[1].Value.Replace("\\\\", "\\").Replace("\\\"", "\"");
                    return Normalize(value, baseDir);
                }
            }
        }
        catch (Exception ex) { HostLog.Write("Config read failed: " + ex.Message); }
        return Normalize(Path.Combine(baseDir, "Content"), baseDir);
    }

    private static void EnsureHtmlOverlayFolder(string contentRoot)
    {
        Directory.CreateDirectory(contentRoot);
        string htmlOverlays = Path.Combine(contentRoot, "html-overlays");
        Directory.CreateDirectory(htmlOverlays);
        WriteEmbeddedResourceIfMissing(HtmlOverlayReadmeResource, Path.Combine(htmlOverlays, "README-FIRST.txt"));
        WriteEmbeddedResourceIfMissing(HtmlOverlayLinkTemplateResource, Path.Combine(htmlOverlays, "overlay-link-template.txt"));
    }

    private static void WriteEmbeddedResourceIfMissing(string resourceName, string destination)
    {
        if (File.Exists(destination)) return;
        using (Stream input = Assembly.GetExecutingAssembly().GetManifestResourceStream(resourceName))
        {
            if (input == null) throw new InvalidOperationException("Embedded resource missing: " + resourceName);
            using (FileStream output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.Read))
            {
                input.CopyTo(output);
            }
        }
    }

    private static string Normalize(string path, string baseDir)
    {
        try
        {
            string expanded = Environment.ExpandEnvironmentVariables(path.Trim().Trim('"'));
            if (!Path.IsPathRooted(expanded)) expanded = Path.Combine(baseDir, expanded);
            return Path.GetFullPath(expanded);
        }
        catch { return null; }
    }
}
