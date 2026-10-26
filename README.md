# Moon Launcher

Moon Launcher is being migrated from Electron to a native Windows WPF application to remove the embedded Chromium runtime and reduce idle overhead.

## Windows downloads

**Recommended: [Download Moon-Launcher-Setup.exe](https://github.com/painopro123456-lang/moon-launcher/releases/download/latest/Moon-Launcher-Setup.exe)**

Run the installer to install Moon Launcher normally. It registers an uninstall entry in Windows **Settings → Apps → Installed apps**, creates a Start Menu shortcut, and offers an optional desktop shortcut. To remove the installed app, use the Windows uninstall entry or the Start Menu's **Uninstall Moon Launcher** shortcut.

[Download the portable Moon-Launcher.exe](https://github.com/painopro123456-lang/moon-launcher/releases/download/latest/Moon-Launcher.exe) if you do not want to install it. A portable executable has no uninstall entry: close the app and delete the EXE file.

The installer does not automatically delete user data when uninstalling.

## Native build status

The native WPF rewrite is in progress. Features from the former Electron application are **not yet all ported**. Minecraft installation and launching, Microsoft login, modpack import/download, and the previous settings are not implemented in this initial native migration. Do not assume the old Electron feature set is available yet.

## Build from source

Install the .NET 8 SDK on Windows, then run:

```powershell
dotnet publish native/MoonLauncher.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o dist
```

The output is `dist/Moon-Launcher.exe`.

To build the installer too, install Inno Setup 6 and compile `installer/MoonLauncher.iss` with Inno Setup Compiler (ISCC.exe).

Moon Launcher is an independent project and is not affiliated with Mojang or Microsoft.
