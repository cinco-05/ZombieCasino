// HOUSE OF THE UNDEAD — single-file Windows launcher.
//
// The whole game (HTML + JS + three.js) rides inside this exe as an embedded
// zip, along with the WebView2 SDK DLLs. On launch it unpacks the game to
// %LOCALAPPDATA%\HouseOfTheUndead and shows it in a fullscreen WebView2 window
// (the Edge engine that ships with Windows). No server, no install, no tabs.
//
// Written for the C# 5 compiler that ships with Windows (.NET Framework 4.x),
// so no string interpolation / null-conditional operators in here.

using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace HouseOfTheUndead
{
    static class Program
    {
        [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
        [DllImport("user32.dll")] static extern bool SetProcessDPIAware();

        public static bool DebugMode;
        public static bool StartWindowed;

        [STAThread]
        static void Main(string[] args)
        {
            // crisp rendering on high-DPI screens (otherwise Windows bitmap-stretches the game)
            try { SetProcessDpiAwarenessContext(new IntPtr(-4)); }
            catch { try { SetProcessDPIAware(); } catch { } }

            foreach (string a in args)
            {
                if (a == "--debug") DebugMode = true;
                if (a == "--windowed") StartWindowed = true;
            }

            // WebView2 managed DLLs live inside this exe — hand them to the runtime on demand
            AppDomain.CurrentDomain.AssemblyResolve += ResolveEmbedded;
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Run();
        }

        // kept separate so WebView2 types aren't touched before the resolver is installed
        [MethodImpl(MethodImplOptions.NoInlining)]
        static void Run() { Application.Run(new GameWindow()); }

        static Assembly ResolveEmbedded(object sender, ResolveEventArgs args)
        {
            string name = new AssemblyName(args.Name).Name;
            byte[] data = Payload.Read("lib." + name + ".dll");
            return data == null ? null : Assembly.Load(data);
        }
    }

    static class Payload
    {
        public static Stream Open(string resource)
        {
            return Assembly.GetExecutingAssembly().GetManifestResourceStream(resource);
        }

        public static byte[] Read(string resource)
        {
            using (Stream s = Open(resource))
            {
                if (s == null) return null;
                using (MemoryStream ms = new MemoryStream())
                {
                    s.CopyTo(ms);
                    return ms.ToArray();
                }
            }
        }

        public static string ReadText(string resource)
        {
            byte[] b = Read(resource);
            return b == null ? "dev" : Encoding.UTF8.GetString(b).Trim();
        }
    }

    class GameWindow : Form
    {
        const string Host = "hotu.game";

        WebView2 web;
        bool fullscreen;
        Rectangle windowedBounds = new Rectangle(0, 0, 1280, 800);
        string gameDir, binDir, dataDir;

        public GameWindow()
        {
            Text = "HOUSE OF THE UNDEAD";
            BackColor = Color.Black;
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
            StartPosition = FormStartPosition.Manual;

            PrepareFiles();
            // must run before any other WebView2 call
            CoreWebView2Environment.SetLoaderDllFolderPath(binDir);

            web = new WebView2();
            web.Dock = DockStyle.Fill;
            web.DefaultBackgroundColor = Color.Black;
            Controls.Add(web);

            Rectangle wa = Screen.PrimaryScreen.WorkingArea;
            int w = Math.Min(1600, wa.Width - 80), h = Math.Min(900, wa.Height - 80);
            windowedBounds = new Rectangle(wa.X + (wa.Width - w) / 2, wa.Y + (wa.Height - h) / 2, w, h);
            Bounds = windowedBounds;
            FormBorderStyle = FormBorderStyle.Sizable;
            if (!Program.StartWindowed) SetFullscreen(true);

            Load += OnLoad;
            // some launchers (shortcuts, scripts) start us minimized — a game should come up front
            Shown += delegate
            {
                if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
                Activate();
            };
        }

        // ------------------------------------------------------------ files --
        void PrepareFiles()
        {
            string baseDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "HouseOfTheUndead");
            string build = Payload.ReadText("build.txt");
            gameDir = Path.Combine(baseDir, "game", build);
            binDir = Path.Combine(baseDir, "bin", build);
            dataDir = Path.Combine(baseDir, "profile");   // saves + settings live here

            baseRoot = baseDir;
            buildId = build;
            if (!File.Exists(Path.Combine(gameDir, "index.html")) || build == "dev")
            {
                CleanOldBuilds(Path.Combine(baseDir, "game"), build);
                Unpack(gameDir);
            }

            string loader = Path.Combine(binDir, "WebView2Loader.dll");
            if (!File.Exists(loader))
            {
                CleanOldBuilds(Path.Combine(baseDir, "bin"), build);
                Directory.CreateDirectory(binDir);
                File.WriteAllBytes(loader, Payload.Read("WebView2Loader.dll"));
            }
        }

        string baseRoot, buildId;

        /** the game files, fresh out of the exe, into dir */
        static void Unpack(string dir)
        {
            string tmp = dir + ".unpack";
            if (Directory.Exists(tmp)) Directory.Delete(tmp, true);
            Directory.CreateDirectory(tmp);
            using (Stream zs = Payload.Open("game.zip"))
            using (ZipArchive zip = new ZipArchive(zs, ZipArchiveMode.Read))
            {
                foreach (ZipArchiveEntry entry in zip.Entries)
                {
                    string rel = entry.FullName.Replace('/', '\\');
                    if (rel.EndsWith("\\")) continue;
                    string dest = Path.Combine(tmp, rel);
                    Directory.CreateDirectory(Path.GetDirectoryName(dest));
                    entry.ExtractToFile(dest, true);
                }
            }
            if (Directory.Exists(dir)) Directory.Delete(dir, true);
            Directory.Move(tmp, dir);
        }

        // If the page can't load (seen once: the game folder briefly refused reads),
        // re-map and retry; the second time, unpack a fresh copy and load that.
        int navRetries = 0;
        void OnNavigated(object sender, CoreWebView2NavigationCompletedEventArgs e)
        {
            if (e.IsSuccess || navRetries >= 2) return;
            navRetries++;
            try
            {
                CoreWebView2 core = web.CoreWebView2;
                if (navRetries == 2)
                {
                    string fresh = Path.Combine(baseRoot, "game", buildId + "-r" + DateTime.Now.Ticks);
                    Unpack(fresh);
                    gameDir = fresh;
                }
                core.ClearVirtualHostNameToFolderMapping(Host);
                core.SetVirtualHostNameToFolderMapping(Host, gameDir, CoreWebView2HostResourceAccessKind.Allow);
                core.Navigate("https://" + Host + "/index.html");
            }
            catch { }
        }

        static void CleanOldBuilds(string root, string keep)
        {
            if (!Directory.Exists(root)) return;
            foreach (string d in Directory.GetDirectories(root))
            {
                if (Path.GetFileName(d) == keep) continue;
                try { Directory.Delete(d, true); } catch { /* in use by another copy — fine */ }
            }
        }

        // ---------------------------------------------------------- webview --
        async void OnLoad(object sender, EventArgs e)
        {
            try
            {
                string flags = "--autoplay-policy=no-user-gesture-required --ignore-gpu-blocklist";
                if (Program.DebugMode) flags += " --remote-debugging-port=9222";
                CoreWebView2EnvironmentOptions opts = new CoreWebView2EnvironmentOptions(flags);
                CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(null, dataDir, opts);
                await web.EnsureCoreWebView2Async(env);

                CoreWebView2 core = web.CoreWebView2;
                core.Settings.AreDevToolsEnabled = Program.DebugMode;
                core.Settings.AreDefaultContextMenusEnabled = false;
                core.Settings.AreBrowserAcceleratorKeysEnabled = Program.DebugMode;
                core.Settings.IsStatusBarEnabled = false;
                core.Settings.IsZoomControlEnabled = false;
                core.Settings.IsSwipeNavigationEnabled = false;
                core.Settings.AreDefaultScriptDialogsEnabled = true;

                core.SetVirtualHostNameToFolderMapping(Host, gameDir, CoreWebView2HostResourceAccessKind.Allow);
                core.WebMessageReceived += OnWebMessage;
                core.NavigationCompleted += OnNavigated;
                core.NewWindowRequested += delegate(object s, CoreWebView2NewWindowRequestedEventArgs a) { a.Handled = true; };
                core.DocumentTitleChanged += delegate { /* keep our own title */ };
                core.Navigate("https://" + Host + "/index.html");
            }
            catch (WebView2RuntimeNotFoundException)
            {
                MessageBox.Show(
                    "This game needs the Microsoft Edge WebView2 Runtime, which comes with Windows 11 " +
                    "and most Windows 10 PCs but seems to be missing here.\n\n" +
                    "Your browser will now open Microsoft's download page. Install it, then run the game again.",
                    "HOUSE OF THE UNDEAD", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                try { Process.Start("https://go.microsoft.com/fwlink/p/?LinkId=2124703"); } catch { }
                Close();
            }
            catch (Exception ex)
            {
                MessageBox.Show("The game failed to start:\n\n" + ex.Message,
                    "HOUSE OF THE UNDEAD", MessageBoxButtons.OK, MessageBoxIcon.Error);
                Close();
            }
        }

        // ------------------------------------------------------------ saves --
        // Every "hotu_" save entry is mirrored into a real file next to the profile,
        // so a wiped or damaged browser store never costs anyone their progress.
        string StorePath { get { return Path.Combine(Path.GetDirectoryName(dataDir), "save.json"); } }

        void SaveStore(string json)
        {
            try
            {
                string path = StorePath, tmp = path + ".tmp";
                if (File.Exists(path))
                {
                    // a store that suddenly shrinks by more than half is suspicious — keep the old one aside
                    long old = new FileInfo(path).Length;
                    if (json.Length < old / 2 && old > 400)
                    {
                        string keep = Path.Combine(Path.GetDirectoryName(path), "save.before-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + ".json");
                        File.Copy(path, keep, true);
                        PruneKeeps(Path.GetDirectoryName(path));
                    }
                }
                File.WriteAllText(tmp, json, new UTF8Encoding(false));
                if (File.Exists(path)) File.Replace(tmp, path, path + ".bak");
                else File.Move(tmp, path);
            }
            catch { }
        }

        static void PruneKeeps(string dir)
        {
            try
            {
                string[] keeps = Directory.GetFiles(dir, "save.before-*.json");
                Array.Sort(keeps);
                for (int i = 0; i < keeps.Length - 5; i++) File.Delete(keeps[i]);
            }
            catch { }
        }

        string LoadStore()
        {
            foreach (string p in new string[] { StorePath, StorePath + ".bak" })
            {
                try
                {
                    if (File.Exists(p))
                    {
                        string s = File.ReadAllText(p, Encoding.UTF8);
                        if (s.Length > 2) return s;
                    }
                }
                catch { }
            }
            return null;
        }

        void OnWebMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            string msg;
            try { msg = e.TryGetWebMessageAsString(); } catch { return; }
            if (msg.StartsWith("store:put:")) { SaveStore(msg.Substring(10)); return; }
            if (msg == "store:get")
            {
                string s = LoadStore();
                try { web.CoreWebView2.PostWebMessageAsString("store:data:" + (s ?? "")); } catch { }
                return;
            }
            if (msg == "quit") Close();
            else if (msg == "fullscreen:toggle") SetFullscreen(!fullscreen);
            else if (msg == "fullscreen:on") SetFullscreen(true);
            else if (msg == "fullscreen:off") SetFullscreen(false);
        }

        void SetFullscreen(bool on)
        {
            if (on == fullscreen && FormBorderStyle == (on ? FormBorderStyle.None : FormBorderStyle.Sizable)) return;
            if (on)
            {
                if (!fullscreen && WindowState == FormWindowState.Normal) windowedBounds = Bounds;
                WindowState = FormWindowState.Normal;
                FormBorderStyle = FormBorderStyle.None;
                Bounds = Screen.FromRectangle(Bounds).Bounds;
            }
            else
            {
                FormBorderStyle = FormBorderStyle.Sizable;
                Bounds = windowedBounds;
            }
            fullscreen = on;
            if (web != null && web.CoreWebView2 != null)
            {
                try { web.CoreWebView2.PostWebMessageAsString(on ? "fullscreen:1" : "fullscreen:0"); } catch { }
            }
        }
    }
}
