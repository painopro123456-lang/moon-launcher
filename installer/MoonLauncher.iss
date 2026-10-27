#define MyAppName "Moon Launcher"
#define MyAppVersion "0.2.0"
#define MyAppPublisher "Moon Launcher"
#define MyAppExeName "Moon-Launcher.exe"

[Setup]
AppId={{B34D0C1A-8A7E-4A57-9B10-0A1B2C3D4E5F}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\Moon Launcher
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=..\dist
OutputBaseFilename=Moon-Launcher-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
SetupIconFile=..\native\moon-icon.ico
ArchitecturesInstallIn64BitMode=x64
ArchitecturesAllowed=x64
UninstallDisplayName={#MyAppName}
Uninstallable=yes
CloseApplications=yes
RestartApplications=no

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: checkedonce

[Files]
Source: "..\dist\Moon-Launcher.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\Moon Launcher"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\{#MyAppExeName}"
Name: "{group}\Uninstall Moon Launcher"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Moon Launcher"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch Moon Launcher"; Flags: postinstall nowait skipifsilent
[UninstallDelete]
; Remove Moon Launcher's per-user profiles, installed modpacks, settings, caches and saved account data.
; This ensures a reinstall starts with a clean MoonLauncher data directory.
Type: filesandordirs; Name: "{localappdata}\\MoonLauncher"
