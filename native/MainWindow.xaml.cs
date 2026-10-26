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
    private readonly MicrosoftAuthService _microsoftAuth = new();
    private string? _modsFolder;
    private List<ModResult> _foundMods = new();
    private ModpackResult? _selectedModpack;
    private bool _modpackInstallRunning;
    private ModResult? _selectedMod;

    private void WindowChrome_MouseLeftButtonDown(object sender, System.Windows.Input.MouseButtonEventArgs e)
    {
        if (e.ButtonState == System.Windows.Input.MouseButtonState.Pressed) DragMove();
    }

    private void MinimizeWindow_Click(object sender, RoutedEventArgs e) => WindowState = WindowState.Minimized;
    private void CloseWindow_Click(object sender, RoutedEventArgs e) => Close();

    public MainWindow()
    {
        InitializeComponent();
        _instancesPath = Path.Combine(_root, "instances.json");
        _serversPath = Path.Combine(_root, "servers.json");
        Directory.CreateDirectory(_root);
        DataDirectory.Text = _root;
        RefreshInstances();
        RefreshServers();
        RefreshMicrosoftAccountStatus();
    }

    private void RefreshMicrosoftAccountStatus()
    {
        var account = _microsoftAuth.GetSavedAccount();
        AccountStatusText.Text = account is null ? "Not signed in" : "Signed in as " + account.Username;
        MicrosoftSignInButton.Content = account is null ? "Sign in with Microsoft" : "Switch account";
        MicrosoftSignOutButton.Visibility = account is null ? Visibility.Collapsed : Visibility.Visible;
    }

    private async void MicrosoftSignIn_Click(object sender, RoutedEventArgs e)
    {
        MicrosoftSignInButton.IsEnabled = false;
        AccountStatusText.Text = "Opening Microsoft sign-in in your browser…";
        try
        {
            var account = await _microsoftAuth.SignInAsync();
            AccountStatusText.Text = "Signed in as " + account.Username;
            StatusText.Text = "Microsoft account connected: " + account.Username + ".";
        }
        catch (Exception ex)
        {
            AccountStatusText.Text = "Sign-in failed";
            StatusText.Text = "Microsoft sign-in failed: " + ex.Message;
            MessageBox.Show(this, ex.Message, "Microsoft sign-in", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
        finally { MicrosoftSignInButton.IsEnabled = true; RefreshMicrosoftAccountStatus(); }
    }

    private void MicrosoftSignOut_Click(object sender, RoutedEventArgs e)
    {
        _microsoftAuth.SignOut(); RefreshMicrosoftAccountStatus(); StatusText.Text = "Signed out of Microsoft account.";
    }

    private void ShowPanel(string panel)
    {
        OverviewHero.Visibility = panel == "home" ? Visibility.Visible : Visibility.Collapsed;
        WorkspacePanel.Visibility = panel == "home" || panel == "versions" ? Visibility.Visible : Visibility.Collapsed;
        OverviewStats.Visibility = panel == "home" ? Visibility.Visible : Visibility.Collapsed;
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
    private void Modpacks_Click(object sender, RoutedEventArgs e) => SetPage("Modpacks", "Find a pack, install it into its own isolated profile, and keep its files separate.", "Search Modrinth or import a .mrpack file to create a dedicated profile.", "modpacks");
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
            _selectedModpack = null;
            using var response = await Http.GetAsync($"https://api.modrinth.com/v2/search?query={query}&facets=%5B%5B%22project_type%3Amodpack%22%5D%5D&limit=30");
            response.EnsureSuccessStatusCode();
            using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            var items = doc.RootElement.GetProperty("hits").EnumerateArray().Select(p =>
            {
                var slug = p.TryGetProperty("slug", out var slugValue) ? slugValue.GetString() ?? "" : "";
                var projectId = p.TryGetProperty("project_id", out var idValue) ? idValue.GetString() ?? "" : "";
                var downloads = p.TryGetProperty("downloads", out var d) ? d.GetInt64().ToString("N0") : "0";
                return new ModpackResult(
                    p.TryGetProperty("title", out var title) ? title.GetString() ?? "Untitled pack" : "Untitled pack",
                    p.TryGetProperty("description", out var desc) ? desc.GetString() ?? "" : "",
                    $"{downloads} downloads  •  {slug}", projectId, slug);
            }).ToList();
            ModpackResults.ItemsSource = items;
            StatusText.Text = $"Found {items.Count} modpack(s). Select one, then choose Install selected pack.";
        }
        catch (Exception ex) { StatusText.Text = "Modrinth search failed: " + ex.Message; }
    }

    private void ModpackResults_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        _selectedModpack = ModpackResults.SelectedItem as ModpackResult;
        if (_selectedModpack is not null)
            StatusText.Text = $"Selected “{_selectedModpack.Title}”. Install it to create an isolated profile.";
    }

    private void OpenSelectedModpack_Click(object sender, System.Windows.Input.MouseButtonEventArgs e)
    {
        if (ModpackResults.SelectedItem is not ModpackResult selected || string.IsNullOrWhiteSpace(selected.Slug)) return;
        try { Process.Start(new ProcessStartInfo { FileName = $"https://modrinth.com/modpack/{Uri.EscapeDataString(selected.Slug)}", UseShellExecute = true }); }
        catch (Exception ex) { StatusText.Text = "Could not open Modrinth project: " + ex.Message; }
    }

    private async void InstallSelectedModpack_Click(object sender, RoutedEventArgs e)
    {
        if (_selectedModpack is null) { StatusText.Text = "Choose a modpack from the results first."; return; }
        if (_modpackInstallRunning) return;
        try
        {
            _modpackInstallRunning = true;
            InstallSelectedModpackButton.IsEnabled = false;
            StatusText.Text = $"Finding the latest release for {_selectedModpack.Title}…";
            var url = $"https://api.modrinth.com/v2/project/{Uri.EscapeDataString(_selectedModpack.ProjectId)}/version";
            using var response = await Http.GetAsync(url);
            response.EnsureSuccessStatusCode();
            using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            var packFile = doc.RootElement.EnumerateArray()
                .SelectMany(v => v.GetProperty("files").EnumerateArray())
                .FirstOrDefault(x => x.TryGetProperty("filename", out var fn) &&
                    string.Equals(fn.GetString(), "modpack.mrpack", StringComparison.OrdinalIgnoreCase));
            if (packFile.ValueKind == JsonValueKind.Undefined)
                packFile = doc.RootElement.EnumerateArray().SelectMany(v => v.GetProperty("files").EnumerateArray())
                    .FirstOrDefault(x => x.TryGetProperty("filename", out var fn) && (fn.GetString() ?? "").EndsWith(".mrpack", StringComparison.OrdinalIgnoreCase));
            if (packFile.ValueKind == JsonValueKind.Undefined) throw new InvalidDataException("Modrinth did not provide an installable .mrpack release.");
            var downloadUrl = packFile.GetProperty("url").GetString() ?? throw new InvalidDataException("Missing modpack download URL.");
            EnsureHttpsUrl(downloadUrl);
            StatusText.Text = $"Downloading {_selectedModpack.Title}…";
            var bytes = await Http.GetByteArrayAsync(downloadUrl);
            if (bytes.Length == 0 || bytes.Length > 2L * 1024 * 1024 * 1024) throw new InvalidDataException("The downloaded modpack is empty or larger than 2 GB.");
            var tempPack = Path.Combine(_root, Guid.NewGuid().ToString("N") + ".mrpack");
            try
            {
                await File.WriteAllBytesAsync(tempPack, bytes);
                await InstallMrpackAsync(tempPack, _selectedModpack.Title);
            }
            finally { if (File.Exists(tempPack)) File.Delete(tempPack); }
        }
        catch (Exception ex) { StatusText.Text = "Modpack install failed: " + ex.Message; }
        finally { _modpackInstallRunning = false; InstallSelectedModpackButton.IsEnabled = true; }
    }

    private async void ImportModpack_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFileDialog { Title = "Import Modrinth modpack", Filter = "Modrinth modpack (*.mrpack)|*.mrpack", CheckFileExists = true };
        if (dialog.ShowDialog(this) != true) return;
        if (_modpackInstallRunning) return;
        try
        {
            _modpackInstallRunning = true;
            InstallSelectedModpackButton.IsEnabled = false;
            await InstallMrpackAsync(dialog.FileName, null);
        }
        catch (Exception ex) { StatusText.Text = "Could not import modpack: " + ex.Message; }
        finally { _modpackInstallRunning = false; InstallSelectedModpackButton.IsEnabled = true; }
    }

    private async Task InstallMrpackAsync(string packPath, string? fallbackName)
    {
        var info = new FileInfo(packPath);
        if (info.Length <= 0 || info.Length > 2L * 1024 * 1024 * 1024)
            throw new InvalidDataException("Pack file is empty or larger than 2 GB.");

        using var archive = ZipFile.OpenRead(packPath);
        var manifestEntry = archive.GetEntry("modrinth.index.json")
            ?? throw new InvalidDataException("This is not a valid Modrinth .mrpack (manifest missing).");
        if (manifestEntry.Length > 5 * 1024 * 1024) throw new InvalidDataException("Modpack manifest is unexpectedly large.");
        using var stream = manifestEntry.Open();
        using var doc = await JsonDocument.ParseAsync(stream);
        var root = doc.RootElement;
        if (!root.TryGetProperty("files", out var files) || files.ValueKind != JsonValueKind.Array)
            throw new InvalidDataException("Modpack manifest has no files list.");
        var name = root.TryGetProperty("name", out var n) ? n.GetString() : null;
        name = string.IsNullOrWhiteSpace(name) ? fallbackName ?? Path.GetFileNameWithoutExtension(packPath) : name.Trim();
        if (name.Length > 100) name = name[..100];
        var dependencies = root.TryGetProperty("dependencies", out var deps) ? deps : default;
        var version = dependencies.ValueKind == JsonValueKind.Object && dependencies.TryGetProperty("minecraft", out var mc)
            ? mc.GetString() ?? "unknown" : "unknown";
        var id = Guid.NewGuid().ToString("N");
        var safeName = string.Concat(name.Select(ch => Path.GetInvalidFileNameChars().Contains(ch) || ch == '/' || ch == '\\' ? '_' : ch)).Trim().Trim('.');
        if (string.IsNullOrWhiteSpace(safeName)) safeName = "Modpack";
        var instancesRoot = Path.Combine(_root, "instances");
        Directory.CreateDirectory(instancesRoot);
        var destination = Path.Combine(instancesRoot, safeName + "-" + id[..8]);
        var staging = destination + ".installing";
        if (Directory.Exists(staging)) Directory.Delete(staging, true);
        Directory.CreateDirectory(staging);
        try
        {
            long totalBytes = 0;
            var count = 0;
            foreach (var item in files.EnumerateArray())
            {
                if (item.TryGetProperty("env", out var env) &&
                    env.ValueKind == JsonValueKind.Object &&
                    env.TryGetProperty("client", out var client) &&
                    string.Equals(client.GetString(), "unsupported", StringComparison.OrdinalIgnoreCase))
                    continue;
                if (!item.TryGetProperty("path", out var pathNode) || string.IsNullOrWhiteSpace(pathNode.GetString()))
                    throw new InvalidDataException("A modpack file has an invalid path.");
                var relative = pathNode.GetString()!;
                var target = ResolveSafePath(staging, relative);
                if (!item.TryGetProperty("downloads", out var downloads) || downloads.ValueKind != JsonValueKind.Array || downloads.GetArrayLength() == 0)
                    continue;
                var fileUrl = downloads[0].GetString() ?? throw new InvalidDataException("A modpack download URL is empty.");
                EnsureHttpsUrl(fileUrl);
                StatusText.Text = $"Installing {name}: downloading file {++count} of {files.GetArrayLength()}…";
                var data = await Http.GetByteArrayAsync(fileUrl);
                totalBytes += data.LongLength;
                if (totalBytes > 4L * 1024 * 1024 * 1024) throw new InvalidDataException("Modpack files exceed the 4 GB safety limit.");
                if (item.TryGetProperty("hashes", out var hashes) && hashes.ValueKind == JsonValueKind.Object &&
                    hashes.TryGetProperty("sha1", out var sha1Node))
                {
                    var expected = sha1Node.GetString();
                    var actual = Convert.ToHexString(System.Security.Cryptography.SHA1.HashData(data)).ToLowerInvariant();
                    if (!string.IsNullOrWhiteSpace(expected) && !actual.Equals(expected, StringComparison.OrdinalIgnoreCase))
                        throw new InvalidDataException($"Hash check failed for {Path.GetFileName(relative)}.");
                }
                Directory.CreateDirectory(Path.GetDirectoryName(target)!);
                await File.WriteAllBytesAsync(target, data);
            }

            long overrideBytes = 0;
            foreach (var entry in archive.Entries)
            {
                var normalized = entry.FullName.Replace('\\', '/');
                string? relative = null;
                if (normalized.StartsWith("overrides/", StringComparison.OrdinalIgnoreCase))
                    relative = normalized["overrides/".Length..];
                else if (normalized.StartsWith("client-overrides/", StringComparison.OrdinalIgnoreCase))
                    relative = normalized["client-overrides/".Length..];
                if (string.IsNullOrEmpty(relative)) continue;
                var target = ResolveSafePath(staging, relative);
                if (normalized.EndsWith("/", StringComparison.Ordinal)) { Directory.CreateDirectory(target); continue; }
                overrideBytes += entry.Length;
                if (overrideBytes > 2L * 1024 * 1024 * 1024) throw new InvalidDataException("Modpack overrides exceed the 2 GB safety limit.");
                Directory.CreateDirectory(Path.GetDirectoryName(target)!);
                await using var input = entry.Open();
                await using var output = new FileStream(target, FileMode.Create, FileAccess.Write, FileShare.None);
                await input.CopyToAsync(output);
            }

            var installInfo = new
            {
                id, name, minecraftVersion = version, createdAt = DateTimeOffset.UtcNow,
                source = "Modrinth .mrpack", modLoaderDependencies = dependencies.ValueKind == JsonValueKind.Object
                    ? dependencies.EnumerateObject().Where(p => p.Name != "minecraft").ToDictionary(p => p.Name, p => p.Value.ToString())
                    : new Dictionary<string, string>()
            };
            await File.WriteAllTextAsync(Path.Combine(staging, "moon-instance.json"),
                JsonSerializer.Serialize(installInfo, new JsonSerializerOptions { WriteIndented = true }));
            Directory.Move(staging, destination);
            var instances = ReadInstances();
            instances.Add(new InstanceEntry(id, name, version, DateTimeOffset.UtcNow));
            File.WriteAllText(_instancesPath, JsonSerializer.Serialize(instances, new JsonSerializerOptions { WriteIndented = true }));
            RefreshInstances();
            StatusText.Text = $"Installed “{name}” into {destination}. Downloaded {count} file(s). Loader metadata and game files are recorded, but Moon Launcher’s game launch pipeline is not finished yet.";
        }
        catch
        {
            if (Directory.Exists(staging)) Directory.Delete(staging, true);
            throw;
        }
    }

    private static string ResolveSafePath(string root, string relativePath)
    {
        var normalized = relativePath.Replace('\\', '/');
        if (Path.IsPathRooted(normalized) || normalized.Split('/').Any(part => part == ".."))
            throw new InvalidDataException("Modpack contains an unsafe file path.");
        var fullRoot = Path.GetFullPath(root) + Path.DirectorySeparatorChar;
        var fullPath = Path.GetFullPath(Path.Combine(root, normalized.Replace('/', Path.DirectorySeparatorChar)));
        if (!fullPath.StartsWith(fullRoot, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Modpack file path escapes the instance directory.");
        return fullPath;
    }

    private static void EnsureHttpsUrl(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps)
            throw new InvalidDataException("Modpack contains a non-HTTPS download URL.");
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

    private void ChooseModsFolder_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFolderDialog { Title = "Choose Minecraft mods folder", Multiselect = false };
        if (dialog.ShowDialog(this) != true) return;
        _modsFolder = dialog.FolderName;
        ModsFolderText.Text = _modsFolder;
        ModInstallStatus.Text = "Target folder selected.";
    }

    private async void SearchMods_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            var query = Uri.EscapeDataString(ModQuery.Text.Trim());
            var versionText = ModGameVersion.Text.Trim();
            var loader = (ModLoaderChoice.SelectedItem as ComboBoxItem)?.Content?.ToString()?.ToLowerInvariant() ?? "fabric";
            if (query.Length == 0) { ModInstallStatus.Text = "Enter a mod name."; return; }
            ModInstallStatus.Text = "Searching Modrinth…";
            var facets = Uri.EscapeDataString(JsonSerializer.Serialize(new[] { new[] { "project_type:mod" } }));
            using var response = await Http.GetAsync($"https://api.modrinth.com/v2/search?query={query}&facets={facets}&limit=30");
            response.EnsureSuccessStatusCode();
            using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            _foundMods = doc.RootElement.GetProperty("hits").EnumerateArray().Select(p => new ModResult(
                p.TryGetProperty("title", out var title) ? title.GetString() ?? "Untitled mod" : "Untitled mod",
                p.TryGetProperty("description", out var desc) ? desc.GetString() ?? "" : "",
                $"{(p.TryGetProperty("downloads", out var downloads) ? downloads.GetInt64().ToString("N0") : "0")} downloads • {loader} • Minecraft {versionText}",
                p.TryGetProperty("project_id", out var id) ? id.GetString() ?? "" : "")).ToList();
            ModResults.ItemsSource = _foundMods;
            ModInstallStatus.Text = $"Found {_foundMods.Count} mods. Select one and install it.";
        }
        catch (Exception ex) { ModInstallStatus.Text = "Search failed: " + ex.Message; }
    }

    private void ModResults_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        _selectedMod = ModResults.SelectedItem as ModResult;
        if (_selectedMod is not null) ModInstallStatus.Text = "Selected " + _selectedMod.Title + ".";
    }

    private async void InstallSelectedMod_Click(object sender, RoutedEventArgs e)
    {
        if (_selectedMod is null) { ModInstallStatus.Text = "Select a mod first."; return; }
        if (string.IsNullOrWhiteSpace(_modsFolder) || !Directory.Exists(_modsFolder)) { ModInstallStatus.Text = "Choose an existing mods folder first."; return; }
        try
        {
            var version = Uri.EscapeDataString(ModGameVersion.Text.Trim());
            var loader = (ModLoaderChoice.SelectedItem as ComboBoxItem)?.Content?.ToString()?.ToLowerInvariant() ?? "fabric";
            ModInstallStatus.Text = "Finding compatible release…";
            var url = $"https://api.modrinth.com/v2/project/{Uri.EscapeDataString(_selectedMod.ProjectId)}/version?game_versions=%5B%22{version}%22%5D&loaders=%5B%22{loader}%22%5D";
            using var response = await Http.GetAsync(url);
            response.EnsureSuccessStatusCode();
            using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            var file = doc.RootElement.EnumerateArray().SelectMany(v => v.GetProperty("files").EnumerateArray()).FirstOrDefault(f => f.TryGetProperty("primary", out var primary) && primary.GetBoolean());
            if (file.ValueKind == JsonValueKind.Undefined) throw new InvalidOperationException("No compatible release found for this Minecraft version and loader.");
            var fileUrl = file.GetProperty("url").GetString() ?? throw new InvalidOperationException("No download URL returned.");
            var filename = Path.GetFileName(new Uri(fileUrl).AbsolutePath);
            if (!filename.EndsWith(".jar", StringComparison.OrdinalIgnoreCase) || filename.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0) throw new InvalidDataException("Invalid mod filename.");
            var target = Path.Combine(_modsFolder, filename);
            if (File.Exists(target)) throw new IOException("Already installed: " + filename);
            ModInstallStatus.Text = "Downloading " + filename + "…";
            var bytes = await Http.GetByteArrayAsync(fileUrl);
            if (bytes.Length == 0 || bytes.Length > 250 * 1024 * 1024) throw new InvalidDataException("Downloaded file size is invalid.");
            await File.WriteAllBytesAsync(target, bytes);
            ModInstallStatus.Text = "Installed " + filename + ".";
        }
        catch (Exception ex) { ModInstallStatus.Text = "Install failed: " + ex.Message; }
    }

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
    private sealed record ModpackResult(string Title, string Description, string Footer, string ProjectId, string Slug);
    private sealed record ModResult(string Title, string Description, string Footer, string ProjectId);
}