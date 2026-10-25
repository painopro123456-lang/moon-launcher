# Moon Launcher

A Windows desktop launcher for Minecraft Java Edition with separate game profiles and modpacks.

## Download for Windows

**[Download Moon Launcher Setup (.exe)](https://github.com/painopro123456-lang/moon-launcher/releases/download/latest/Moon-Launcher-Setup.exe)**

This link downloads the Windows installer directly. Open the downloaded `Moon-Launcher-Setup.exe` to install Moon Launcher; there is no ZIP to extract. Each update to the `main` branch rebuilds and refreshes this direct-download installer.

The installer is unsigned, so Windows may show an unknown-publisher prompt.

## Features

- Browse Minecraft versions and create separate vanilla instances.
- Sign in with Microsoft in your default browser. After you finish, the browser returns to Moon Launcher automatically.
- Install and launch vanilla Minecraft. Game files are shared where possible; each instance keeps its own saves, options, and mods folder.
- Choose the Moon Launcher directory in Settings. Existing instance and game data is moved into the selected folder. Microsoft account tokens remain encrypted in Windows secure storage.
- Choose memory, download connections, and whether Minecraft starts fullscreen.
- Search Modrinth modpacks, download and checksum-verify their files, and import local `.mrpack` files.

## Microsoft sign-in

Moon Launcher includes its public Microsoft Application (client) ID, so users do not need to register an app or enter an ID in Settings. Each player signs in with their own personal Microsoft account in the default browser. The app uses a desktop public-client authorization flow and does not contain a client secret. Sign-in can only complete for an account that owns Minecraft: Java Edition.

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
