# Moon Launcher

Moon Launcher is being migrated from Electron to a native Windows WPF application to remove the embedded Chromium runtime and reduce idle overhead.

## Windows downloads

**Recommended: [Download Moon-Launcher-Setup.exe](https://github.com/painopro123456-lang/moon-launcher/releases/download/latest/Moon-Launcher-Setup.exe)**

Run the installer to install Moon Launcher normally. It registers an uninstall entry in Windows **Settings → Apps → Installed apps**, creates a Start Menu shortcut, and offers an optional desktop shortcut. To remove the installed app, use the Windows uninstall entry or the Start Menu's **Uninstall Moon Launcher** shortcut.

[Download the portable Moon-Launcher.exe](https://github.com/painopro123456-lang/moon-launcher/releases/download/latest/Moon-Launcher.exe) if you do not want to install it. A portable executable has no uninstall entry: close the app and delete the EXE file.

The installer does not automatically delete user data when uninstalling.

## Native build status

The native WPF build includes Microsoft sign-in, the official Minecraft version catalog, instance creation, and an **Install & Play** action powered by CmlLib.Core. The first launch downloads the selected version's required files. The launcher uses the embedded Microsoft Client ID and the locally saved Minecraft session; if the saved game token expires, sign in again. CmlLib.Core documents support for vanilla and modified versions, but its published testing notes currently only confirm versions through 1.21, so Minecraft 26.2 still requires a real launch test before it can be called verified.

## Build from source

Install the .NET 8 SDK on Windows, then run:

```powershell
dotnet publish native/MoonLauncher.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o dist
```

The output is `dist/Moon-Launcher.exe`.

To build the installer too, install Inno Setup 6 and compile `installer/MoonLauncher.iss` with Inno Setup Compiler (ISCC.exe).

Moon Launcher is an independent project and is not affiliated with Mojang or Microsoft.
