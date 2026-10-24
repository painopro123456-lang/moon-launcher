# Moon Launcher

A Windows desktop launcher for Minecraft Java Edition with separate game profiles and modpacks.

## Download for Windows

Every update to the `main` branch builds a Windows 64-bit installer.

1. Open the repository's **Actions** tab.
2. Choose the latest successful **Windows download** run.
3. Under **Artifacts**, download **Moon-Launcher-Windows-x64**.
4. Unzip it, then open `Moon-Launcher-Setup-0.1.0-x64.exe`.

GitHub keeps preview builds for 14 days. The installer is unsigned, so Windows may show an unknown-publisher prompt.

## Features

- Browse Minecraft versions and create separate vanilla instances.
- Sign in with Microsoft in your default browser. After you finish, the browser returns to Moon Launcher automatically.
- Install and launch vanilla Minecraft. Game files are shared where possible; each instance keeps its own saves, options, and mods folder.
- Choose the Moon Launcher directory in Settings. Existing instance and game data is moved into the selected folder. Microsoft account tokens remain encrypted in Windows secure storage.
- Choose memory, download connections, and whether Minecraft starts fullscreen.
- Search Modrinth modpacks, download and checksum-verify their files, and import local `.mrpack` files.

## One-time Microsoft setup

For Microsoft sign-in, each user needs a public Application (client) ID from a Microsoft Entra app registration. Configure supported account types to include personal Microsoft accounts. Under **Authentication**, add the **Mobile and desktop applications** platform and the `http://localhost` redirect URI; enable public client flows if the portal offers that setting. Paste the Application (client) ID into Moon Launcher Settings. The app opens Microsoft sign-in in your default browser and returns to the launcher automatically. It never asks you to enter your Microsoft password inside the launcher or uses a client secret.

Sign-in can only complete for an account that owns Minecraft: Java Edition. Moon Launcher stores its refresh token encrypted with Windows secure storage.

## Current limits

Modrinth packs with Fabric, Forge, or another mod loader can be installed as files, but loader setup is not connected yet, so those packs cannot launch. CurseForge import reads pack metadata only; downloadable CurseForge content requires an approved integration.

## Run from source

Install Node.js 22.16 or newer, then run:

```sh
npm install
npm start
```

Moon Launcher is an independent project and is not affiliated with Mojang or Microsoft.
