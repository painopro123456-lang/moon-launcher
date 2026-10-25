using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Text.Json;
using System.IO.Compression;
using System.Windows;
using System.Windows.Controls;
using Microsoft.Win32;

namespace MoonLauncher;

public partial class MainWindow : Window
{
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(25) };
    private readonly string _root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MoonLauncher");
    private readonly string _instancesPath;
    private readonly string _serversPath;
    private List<VersionEntry> _versions = new();

    public MainWindow()
    {
        InitializeComponent();
        _instancesPath = Path.Combine(_root, "instances.json");
        _serversPath = Path.Combine(_root, "servers.json");
        Directory.CreateDirectory(_root);
        DataDirectory.Text = _root;
        RefreshInstances();
        RefreshServers();
    }

    private void ShowPanel(string panel)
    {
        ModpacksPanel.Visibility = panel == "modpacks" ? Visibility.Visible : Visibility.Collapsed;
        ServersPanel.Visibility = panel == "servers" ? Visibility.Visible : Visibility.Collapsed;
        ModsPanel.Visibility = panel == "mods" ? Visibility.Visible : Visibility.Collapsed;
        SettingsPanel.Visibility = panel == "settings" ? Visibility.Visible : Visibility.Collapsed;
        VersionsList.Visibility = panel == "versions" ? Visibility.Visible : Visibility.Collapsed;
    }

    private void SetPage(string title, string subtitle, string status, string panel = "home")
    {
        ShowPanel(panel);
        PageTitle.Text = title;
        PageSubtitle.Text = subtitle;
        StatusText.Text = status;
    }

    private void Overview_Click(object sender, RoutedEventArgs e) => SetPage("Welcome to Moon", "Your Minecraft library, without the extra weight.", "Ready. Browse Modrinth modpacks, load the official version catalog, or create a local profile.");
    private void Versions_Click(object sender, RoutedEventArgs e) => SetPage("Minecraft versions", "Official Mojang version manifest.", "Load the catalog to see available releases and snapshots.", "versions");
    private void Instances_Click(object sender, RoutedEventArgs e) => SetPage("Instances", "Local launcher profiles stored in your Windows user profile.", $"{ReadInstances().Count} instance(s) found.");
    private void Modpacks_Click(object sender, RoutedEventArgs e) => SetPage("Modpacks", "Discover projects from Modrinth.", "Search the Modrinth catalog below. Installing full modpacks is not yet ported.", "modpacks");
    private void Mods_Click(object sender, RoutedEventArgs e) => SetPage("Mods", "Manage mods for your local Minecraft setup.", "Full instance-aware mod management is still being ported.", "mods");
    private void Servers_Click(object sender, RoutedEventArgs e) => SetPage("Servers", "Keep your multiplayer addresses handy.", "Server shortcuts are saved locally on this PC.", "servers");
    private void Settings_Click(object sender, RoutedEventArgs e) => SetPage("Settings", "Moon Launcher preferences.", $"Data folder: {_root}", "settings");

    private async void LoadVersions_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            StatusText.Text = "Downloading the official Minecraft version manifest…";
            var json = await Http.GetStringAsync("https://launchermeta.mojang.com/mc/game/version_manifest_v2.json");
            using var doc = JsonDocument.Parse(json);
            _versions = doc.RootElement.GetProperty("versions").EnumerateArray().Select(v => new VersionEntry(
                v.GetProperty("id").GetString() ?? "",
                v.GetProperty("type").GetString() ?? "",
                v.GetProperty("releaseTime").GetString() ?? "")).ToList();
            VersionCount.Text = $"{_versions.Count:N0} versions";
            VersionsList.ItemsSource = _versions.Select(v => $"{v.Id}   •   {v.Type}   •   {v.ReleaseTime[..Math.Min(10, v.ReleaseTime.Length)]}").ToList();
            ShowPanel("versions");
            StatusText.Text = "Catalog loaded. Native game installation and launching are still being ported.";
        }
        catch (Exception ex) { StatusText.Text = "Could not load Minecraft versions: " + ex.Message; }
    }

    private async void SearchModpacks_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            var query = Uri.EscapeDataString(ModpackQuery.Text.Trim());
            StatusText.Text = "Searching Modrinth…";
            ModpackResults.ItemsSource = null;
            using var response = await Http.GetAsync($"https://api.modrinth.com/v2/search?query={query}&facets=%5B%5B%22project_type%3Amodpack%22%5D%5D&limit=30");
            response.EnsureSuccessStatusCode();
            using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            var items = doc.RootElement.GetProperty("hits").EnumerateArray().Select(p => new ModpackResult(
                p.TryGetProperty("title", out var title) ? title.GetString() ?? "Untitled pack" : "Untitled pack",
                p.TryGetProperty("description", out var desc) ? desc.GetString() ?? "" : "",
                $"{(p.TryGetProperty("downloads", out var downloads) ? downloads.GetInt64().ToString("N0") : "0")} downloads  •  { (p.TryGetProperty("slug", out var slug) ? slug.GetString() : "")}",
                p.TryGetProperty("slug", out var slug2) ? slug2.GetString() ?? "" : "")).ToList();
            ModpackResults.ItemsSource = items;
            StatusText.Text = $"Found {items.Count} Modrinth modpack(s). Select a result and press Enter to open its project page.";
        }
        catch (Exception ex) { StatusText.Text = "Modrinth search failed: " + ex.Message; }
    }


    private void OpenSelectedModpack_Click(object sender, System.Windows.Input.MouseButtonEventArgs e)
    {
        if (ModpackResults.SelectedItem is not ModpackResult selected || string.IsNullOrWhiteSpace(selected.Slug)) return;
        try { Process.Start(new ProcessStartInfo { FileName = $"https://modrinth.com/modpack/{Uri.EscapeDataString(selected.Slug)}", UseShellExecute = true }); }
        catch (Exception ex) { StatusText.Text = "Could not open Modrinth project: " + ex.Message; }
    }

    private void ImportModpack_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFileDialog { Title = "Import Modrinth modpack", Filter = "Modrinth modpack (*.mrpack)|*.mrpack", CheckFileExists = true };
        if (dialog.ShowDialog(this) != true) return;
        try
        {
            var info = new FileInfo(dialog.FileName);
            if (info.Length <= 0 || info.Length > 2L * 1024 * 1024 * 1024) throw new InvalidDataException("Pack file is empty or larger than 2 GB.");
            using var archive = ZipFile.OpenRead(dialog.FileName);
            var manifestEntry = archive.GetEntry("modrinth.index.json") ?? throw new InvalidDataException("This is not a valid Modrinth .mrpack (manifest missing).");
            if (manifestEntry.Length > 5 * 1024 * 1024) throw new InvalidDataException("Modpack manifest is unexpectedly large.");
            using var stream = manifestEntry.Open();
            using var doc = JsonDocument.Parse(stream);
            var root = doc.RootElement;
            var name = root.TryGetProperty("name", out var n) ? n.GetString() : null;
            var version = root.TryGetProperty("dependencies", out var deps) && deps.TryGetProperty("minecraft", out var mc) ? mc.GetString() : null;
            name = string.IsNullOrWhiteSpace(name) ? Path.GetFileNameWithoutExtension(dialog.FileName) : name.Trim();
            version = string.IsNullOrWhiteSpace(version) ? "unknown" : version;
            var instances = ReadInstances();
            instances.Add(new InstanceEntry(Guid.NewGuid().ToString("N"), name, version, DateTimeOffset.UtcNow));
            File.WriteAllText(_instancesPath, JsonSerializer.Serialize(instances, new JsonSerializerOptions { WriteIndented = true }));
            RefreshInstances();
            StatusText.Text = $"Validated “{name}” (Minecraft {version}) and added a profile record. Files and dependencies have NOT been installed yet.";
        }
        catch (Exception ex) { StatusText.Text = "Could not import modpack: " + ex.Message; }
    }

    private void CreateInstance_Click(object sender, RoutedEventArgs e)
    {
        var name = Microsoft.VisualBasic.Interaction.InputBox("Enter a name for the new instance:", "Create instance", "My Minecraft");
        if (string.IsNullOrWhiteSpace(name)) return;
        var version = _versions.FirstOrDefault(v => v.Type == "release")?.Id ?? "latest release";
        var instances = ReadInstances();
        instances.Add(new InstanceEntry(Guid.NewGuid().ToString("N"), name.Trim(), version, DateTimeOffset.UtcNow));
        File.WriteAllText(_instancesPath, JsonSerializer.Serialize(instances, new JsonSerializerOptions { WriteIndented = true }));
        RefreshInstances();
        StatusText.Text = $"Created local profile “{name.Trim()}”. Game installation and launch are not yet implemented.";
    }

    private void AddServer_Click(object sender, RoutedEventArgs e)
    {
        var name = ServerName.Text.Trim();
        var address = ServerAddress.Text.Trim();
        if (name.Length == 0 || address.Length == 0 || address.Any(char.IsWhiteSpace) || address.Contains("://"))
        {
            StatusText.Text = "Enter a server name and a hostname or hostname:port (no URL scheme or spaces).";
            return;
        }
        var servers = ReadServers();
        servers.Add(new ServerEntry(Guid.NewGuid().ToString("N"), name, address));
        SaveServers(servers);
        ServerName.Clear(); ServerAddress.Clear(); RefreshServers();
        StatusText.Text = $"Saved server “{name}”.";
    }

    private void RefreshServers() => ServerList.ItemsSource = ReadServers().Select(s => $"{s.Name}    —    {s.Address}").ToList();
    private List<ServerEntry> ReadServers()
    {
        try { return JsonSerializer.Deserialize<List<ServerEntry>>(File.ReadAllText(_serversPath)) ?? new(); }
        catch { return new(); }
    }
    private void SaveServers(List<ServerEntry> servers) => File.WriteAllText(_serversPath, JsonSerializer.Serialize(servers, new JsonSerializerOptions { WriteIndented = true }));

    private void OpenDataFolder_Click(object sender, RoutedEventArgs e)
    {
        try { Directory.CreateDirectory(_root); Process.Start(new ProcessStartInfo { FileName = _root, UseShellExecute = true }); }
        catch (Exception ex) { StatusText.Text = "Could not open data folder: " + ex.Message; }
    }

    private List<InstanceEntry> ReadInstances()
    {
        try { return JsonSerializer.Deserialize<List<InstanceEntry>>(File.ReadAllText(_instancesPath)) ?? new(); }
        catch { return new(); }
    }
    private void RefreshInstances() => InstanceCount.Text = $"{ReadInstances().Count} instances";

    private sealed record VersionEntry(string Id, string Type, string ReleaseTime);
    private sealed record InstanceEntry(string Id, string Name, string Version, DateTimeOffset CreatedAt);
    private sealed record ServerEntry(string Id, string Name, string Address);
    private sealed record ModpackResult(string Title, string Description, string Footer, string Slug);
}