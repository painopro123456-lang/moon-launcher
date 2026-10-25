using System.IO;
using System.Net.Http;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;

namespace MoonLauncher;

public partial class MainWindow : Window
{
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(20) };
    private readonly string _root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MoonLauncher");
    private readonly string _instancesPath;
    private List<VersionEntry> _versions = new();

    public MainWindow()
    {
        InitializeComponent();
        _instancesPath = Path.Combine(_root, "instances.json");
        Directory.CreateDirectory(_root);
        RefreshInstances();
    }

    private void SetPage(string title, string subtitle, string status)
    {
        PageTitle.Text = title;
        PageSubtitle.Text = subtitle;
        StatusText.Text = status;
    }

    private void Overview_Click(object sender, RoutedEventArgs e) => SetPage("Welcome to Moon Launcher", "A lightweight native Windows shell for Minecraft Java Edition.", "Ready. Use Load Minecraft versions to fetch the official version catalog.");
    private void Versions_Click(object sender, RoutedEventArgs e) { VersionsList.Visibility = Visibility.Visible; SetPage("Minecraft versions", "Official Mojang version manifest.", "Load the catalog to see available releases and snapshots."); }
    private void Instances_Click(object sender, RoutedEventArgs e) => SetPage("Instances", "Local launcher profiles stored in your Windows user profile.", $"{ReadInstances().Count} instance(s) found.");
    private void Settings_Click(object sender, RoutedEventArgs e) => SetPage("Settings", "Native migration build", $"Data folder: {_root}. More settings are being ported from the previous app.");

    private async void LoadVersions_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            StatusText.Text = "Downloading the official Minecraft version manifest…";
            var json = await Http.GetStringAsync("https://launchermeta.mojang.com/mc/game/version_manifest_v2.json");
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            _versions = root.GetProperty("versions").EnumerateArray().Select(v => new VersionEntry(
                v.GetProperty("id").GetString() ?? "",
                v.GetProperty("type").GetString() ?? "",
                v.GetProperty("releaseTime").GetString() ?? "")).ToList();
            VersionCount.Text = $"{_versions.Count:N0} versions";
            VersionsList.ItemsSource = _versions.Select(v => $"{v.Id}   •   {v.Type}   •   {v.ReleaseTime[..Math.Min(10, v.ReleaseTime.Length)]}").ToList();
            VersionsList.Visibility = Visibility.Visible;
            StatusText.Text = "Catalog loaded. This migration build does not yet install or launch the game.";
        }
        catch (Exception ex) { StatusText.Text = "Could not load Minecraft versions: " + ex.Message; }
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
        StatusText.Text = $"Created instance “{name.Trim()}”. Game installation and launch are not implemented in this first native migration build.";
    }

    private List<InstanceEntry> ReadInstances()
    {
        try { return JsonSerializer.Deserialize<List<InstanceEntry>>(File.ReadAllText(_instancesPath)) ?? new(); }
        catch { return new(); }
    }
    private void RefreshInstances() => InstanceCount.Text = $"{ReadInstances().Count} instances";

    private sealed record VersionEntry(string Id, string Type, string ReleaseTime);
    private sealed record InstanceEntry(string Id, string Name, string Version, DateTimeOffset CreatedAt);
}