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
- Search Modrinth modpacks.
- Read metadata from Modrinth `.mrpack` and CurseForge `.zip` manifests.

## What is not ready yet

This download is an early preview, not a complete playable Minecraft launcher. It does **not** download or install Minecraft or modpack files, sign into Microsoft, or launch the game. The launch action remains disabled. The Minecraft engine still needs to be connected.

## Run from source

Install Node.js 22.16 or newer, then run:

```sh
npm install
npm start
```

The app must never ask for or store a Microsoft account password. A Microsoft app registration is needed before publishing account sign-in.

Moon Launcher is an independent project and is not affiliated with Mojang or Microsoft.