# Moon Launcher

A Windows desktop launcher project for managing Minecraft versions, isolated instances, and modpacks.

## Current preview

- Reads the current Minecraft version catalog.
- Saves named local instance entries.
- Searches Modrinth modpacks.
- Reads metadata from Modrinth \`.mrpack\` and CurseForge \`.zip\` manifests.

This is an early application scaffold. It does **not** download or install Minecraft, download modpack files, sign into Microsoft, or launch the game yet. The launch action remains disabled until those pieces are implemented.

## Run the preview

Install Node.js 22.16 or newer, then run:

\`\`\`sh
npm install
npm start
\`\`\`

## Planned launcher work

1. Microsoft sign-in using the official browser-based account flow.
2. Minecraft and Java installation, followed by secure game launching through the XMCL core packages.
3. Full modpack installation and updates for Modrinth and CurseForge, including the platforms' download restrictions.
4. Windows packaging and release builds.

The app must never ask for or store a Microsoft account password. A Microsoft app registration is needed before publishing account sign-in.

## Project notes

Moon Launcher is an independent project and is not affiliated with Mojang or Microsoft. It uses the MIT-licensed \`@xmcl/*\` launcher packages as its planned Minecraft engine.