# Moon Launcher

A Windows desktop launcher project for managing Minecraft versions, isolated instances, and modpacks.

## Download the Windows preview

Every update to the `main` branch builds a Windows 64-bit installer.

1. Open the repository's **Actions** tab.
2. Choose the newest successful **Windows download** run.
3. Under **Artifacts**, download **Moon-Launcher-Windows-x64**.
4. Unzip the download, then open `Moon-Launcher-Setup-0.1.0-x64.exe` and follow the installer.

GitHub keeps each build artifact for 14 days. This preview installer is unsigned, so Windows may show an unknown-publisher prompt.

## What this preview can do

- Browse the Minecraft version catalog.
- Save named local instance entries.
- Search Modrinth modpacks and install the latest pack version into its own instance folder.
- Download and SHA-1/SHA-512 verify pack files, then apply client overrides from the .mrpack.
- Import local Modrinth .mrpack files; read metadata from CurseForge .zip manifests.

## What is not ready yet

This download is an early preview, not a complete playable Minecraft launcher. It installs Modrinth pack files into isolated instance folders, but it does **not** install the Minecraft game or mod loader, sign into Microsoft, or launch the game. CurseForge pack imports currently add manifest details only; installing their files needs an approved CurseForge integration. The launch action remains disabled while the Minecraft engine is being connected.

## Run from source

Install Node.js 22.16 or newer, then run:

```sh
npm install
npm start
```

The app must never ask for or store a Microsoft account password. A Microsoft app registration is needed before publishing account sign-in.

Moon Launcher is an independent project and is not affiliated with Mojang or Microsoft.