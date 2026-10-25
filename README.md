# Moon Launcher

Moon Launcher is being migrated from Electron to a native Windows WPF application to remove the embedded Chromium runtime and reduce idle overhead.

## Native Windows build

The GitHub Actions workflow builds a self-contained Windows x64 executable:

**[Download Moon-Launcher.exe](https://github.com/painopro123456-lang/moon-launcher/releases/download/latest/Moon-Launcher.exe)**

This is a direct application executable, not an installer. The first native migration build contains the native UI, local instance records, and the official Minecraft version catalog.

## Migration status

The native WPF rewrite is in progress. Features from the former Electron application are **not yet all ported**. In this initial native build, Minecraft installation and launching, Microsoft login, modpack import/download, and the previous settings are not implemented. Do not assume the old Electron feature set is available in the native build yet.

## Build from source

Install the .NET 8 SDK on Windows, then run:

```powershell
dotnet publish native/MoonLauncher.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o dist
```

The output is `dist/Moon-Launcher.exe`.

Moon Launcher is an independent project and is not affiliated with Mojang or Microsoft.
