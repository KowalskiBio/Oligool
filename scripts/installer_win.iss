; ==========================================
; Oligool Windows Installer (Inno Setup 6)
; ==========================================
; Fully self-contained "Next > Next > Finish" wizard:
;   - no admin rights needed (installs under %LOCALAPPDATA%\Programs)
;   - bundles the entire PyInstaller onedir payload (Python runtime,
;     FastAPI backend, primer3/strider, MAFFT, built frontend)
;   - bundles Microsoft's offline WebView2 Runtime installer and runs it
;     silently ONLY if the runtime is missing (required by pywebview)
;
; Build: ISCC.exe /DAppVersion=1.2.3 scripts\installer_win.iss
; The CI workflow runs this after scripts\build_win.bat.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

#define AppName "Oligool"
#define AppPublisher "KowalskiBio"
#define AppExeName "Oligool.exe"

[Setup]
AppId={{B41F8A2E-3C7D-4A91-9E6C-2D5F7A8B1C04}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={localappdata}\Programs\Oligool
DefaultGroupName={#AppName}
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\dist
OutputBaseFilename=Oligool-Setup-{#AppVersion}-windows-x86_64
SetupIconFile=..\frontend\public\rabbit_oligool.ico
UninstallDisplayIcon={app}\{#AppExeName}
LicenseFile=..\LICENSE
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional icons:"

[Files]
Source: "..\dist\Oligool\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\LICENSE"; DestDir: "{app}"; Flags: ignoreversion
; Offline WebView2 runtime, staged to {tmp} and deleted after setup.
; Only extracted when the runtime is actually missing (see Check).
Source: "..\.bin\webview2\MicrosoftEdgeWebView2RuntimeInstallerX64.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall; Check: not WebView2Installed

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExeName}"
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Run]
Filename: "{tmp}\MicrosoftEdgeWebView2RuntimeInstallerX64.exe"; Parameters: "/silent /install"; StatusMsg: "Installing Microsoft Edge WebView2 Runtime (one-time, needed to show the app window)..."; Check: not WebView2Installed; Flags: waituntilterminated
Filename: "{app}\{#AppExeName}"; Description: "Launch {#AppName}"; Flags: nowait postinstall skipifsilent

[Code]
{ Detects the Edge WebView2 Runtime per Microsoft's documentation:
  checks 'pv' under both the per-machine (HKLM, 64-bit view) and
  per-user (HKCU) EdgeUpdate client keys. Missing, empty or 0.0.0.0
  means not installed. }
function WebView2Installed: Boolean;
var
  Version: String;
begin
  Result := False;
  if RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) then
    if (Version <> '') and (Version <> '0.0.0.0') then
      Result := True;
  if not Result then
    if RegQueryStringValue(HKCU, 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) then
      if (Version <> '') and (Version <> '0.0.0.0') then
        Result := True;
end;
