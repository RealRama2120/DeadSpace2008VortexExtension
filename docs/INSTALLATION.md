# Dead Space (2008) Vortex Extension

Version 1.0.0  
Author: Rama2120

This community extension adds Vortex support for the original Windows release of
Dead Space (2008). It deliberately does not support or detect Dead Space (2023).

## What it does

- Detects Steam App ID 17470.
- Checks common EA App, EA Games, Electronic Arts, and Origin registry locations.
- Checks every mounted Windows drive letter for common EA App, Origin, Steam, and
  custom game-library layouts.
- Performs a bounded search beneath top-level library folders without recursively
  crawling an entire disk.
- Accepts a candidate only when `Dead Space.exe` and multiple original-2008 data
  folders are present. The remake's `Data/Win32` layout is explicitly rejected.
- Deploys normal DLL, INI, ASI, configuration, and ReShade files to the game root,
  beside `Dead Space.exe`.
- Checks that the game root is genuinely writable before Vortex starts deployment.
  Already-writable folders require no prompt. For a protected folder, the extension
  uses one clear access dialog and one Windows UAC approval, combines concurrent
  checks, and stops before Vortex's repeating permission path if access is denied.
- Removes a single unnecessary archive wrapper folder for common root-folder mods.
- Places TexMod `.tpf` packages in `TexMod Packages` under the game folder and
  explains the remaining manual TexMod step.

## Local test installation

1. Close Vortex.
2. Remove any older test extension so two copies do not
   register the same game.
3. Extract this ZIP into a new folder under `%APPDATA%\Vortex\Plugins`.
   The result should look like:

       %APPDATA%\Vortex\Plugins\dead-space-2008-0.2.6\index.js
       %APPDATA%\Vortex\Plugins\dead-space-2008-0.2.6\info.json
       %APPDATA%\Vortex\Plugins\dead-space-2008-0.2.6\gameart.png

   If your Vortex build offers **Extensions > Install From File**, selecting the
   ZIP there is also suitable.
4. Start Vortex and use **Games > Scan**.
5. Confirm that Vortex finds the folder containing the original `Dead Space.exe`.
   If Windows protects that folder, choose **Grant access** in the extension's
   one-time dialog and approve the Windows UAC prompt. The extension creates and
   removes a tiny test file before allowing Vortex to attempt any mod files.
6. If automatic discovery still fails, set the game folder manually. Select the
   folder containing `Dead Space.exe` plus the original `loading_screen`,
   `audiostreams`, and `movies` folders, not a launcher folder or the 2023 remake.
7. Install a small root-folder mod, deploy it, and confirm its DLL/INI files appear
   beside `Dead Space.exe`. Purge the test afterward and confirm Vortex removes the
   deployed files.

## Supported mod layouts

### DLL, INI, ASI, fixes, and ReShade files

The main deployment target is the game root. Archives containing common root mod
files are routed there. If every file is inside one packaging-only wrapper folder,
the extension removes that wrapper while preserving meaningful folders such as
`reshade-shaders`.

Vortex does not run executable installers. If a mod is distributed only as an EXE,
follow that mod author's instructions. For ReShade, install the ReShade runtime in
the way its author requires; Vortex can then manage presets, shaders, and compatible
root files.

### TexMod `.tpf` packages

Vortex can install, enable, disable, deploy, and purge `.tpf` package files, but it
cannot inject them into the running game. The extension deploys them here:

    <Dead Space game folder>\TexMod Packages

To use one, launch through TexMod, choose the original `Dead Space.exe`, add the
desired `.tpf` package from that folder, and start the game through TexMod. TexMod
itself is not included or redistributed by this extension.

## Discovery details and troubleshooting

Discovery is attempted in this order:

1. Vortex's game-store helper using Steam App ID 17470.
2. Machine-wide and current-user EA/Origin registry locations, including both
   32-bit and 64-bit registry views commonly used by older EA releases, including
   the EA App key `Electronic Arts\Dead Space`.
3. Mounted drives `A:` through `Z:` using common EA Games, Origin Games,
   Electronic Arts, Steam library, and custom Games directory layouts.
4. A bounded check of top-level library directories on each mounted drive.

The scan is read-only and does not modify registry data or crawl every directory.
Only deployment changes files, using Vortex's normal deployment and purge system.

### Game-folder permissions

Dead Space root mods must be placed beside `Dead Space.exe`. When the EA App installs
the game directly under `Program Files`, its folder can inherit only Read/Execute
access for normal users. The access flow introduced in version 0.2.4 first uses a
silent raw create-and-remove test.
If Windows denies it, the extension shows one explanation and launches Windows'
built-in `icacls.exe` with administrator approval. The command grants `(OI)(CI)M`
(inherited Modify) to the current user's Windows SID on the validated Dead Space
folder only. It does not change all of `Program Files`, other games, or registry data.

The supplied Vortex 2.5.0 log showed why its normal **Allow access** button looped:
its elevated scripts failed with `Cannot find module 'fs-extra'` and `Cannot find
module 'permissions'`, so the folder ACL never changed. The extension bypasses those
broken temporary scripts. It registers an awaited `will-deploy` handler; Vortex runs
that handler during **Running pre-deployment events**, before **Starting deployment**
and before the destination writable check that opened the repeated dialogs.

The verified path is cached for the current Vortex session, and simultaneous setup
or deployment checks share one operation. If the extension dialog or Windows UAC is
cancelled, deployment stops before Vortex's permission loop begins. Choose Manage or
Deploy again whenever you are ready to retry the one-time approval.

The installed Monster Hunter Wilds community extension follows the normal pattern:
root mod types target the game path and only its Fluffy subfolders are checked during
setup. That works without extra handling because the user's Steam libraries already
grant Modify or Full Control. The Dead Space workaround activates only after a real
write probe fails, so writable Steam/custom libraries continue with no prompt.

The 2008 and 2023 games can both use the filename `Dead Space.exe`. To prevent a
false match, this extension requires multiple original streamed-data folders,
rejects `Data\Win32`, and rejects an executable size characteristic of the much
larger remake executable. `GL.ini` is not required because EA App installations do
not necessarily include it.

When reporting a detection problem, include:

- Store: EA App, Origin, Steam, or retail.
- Exact game folder path (omit your Windows username if desired).
- Whether `Dead Space.exe`, `audiostreams`, `loading_screen`, and `movies` exist in
  that folder.
- The relevant Vortex log lines containing `Dead Space (2008)`.

## Nexus release notes

- Upload the ZIP as the only **Main File** under the Vortex **Extensions** category.
- Use exactly version `1.0.0` on Nexus so it matches `info.json`.
- Keep `index.js`, `info.json`, and `gameart.png` at the archive root.
- Include numeric Nexus game ID `1656` in `info.json`.
- GitHub pre-approval is no longer required. Eligible uploads are picked up within
  two hours; Vortex lists the most endorsed extension when several support one game.
- Nexus performs periodic reviews after publication.

Current Vortex developer references used for this release:

- https://github.com/Nexus-Mods/Vortex/tree/master/packages/vortex-api
- https://github.com/Nexus-Mods/Vortex/wiki/How-to-package-a-game-extension
- https://github.com/Nexus-Mods/Vortex/wiki/How-to-test-a-game-extension

## Legal

This extension contains no game files, EA assets, third-party mod binaries, TexMod
binaries, ReShade binaries, or DeadSpace2008Fixes binaries. Dead Space and related
marks belong to their respective owners. This project is an unofficial community
extension and is not endorsed by Electronic Arts or Nexus Mods.

The extension code and original package artwork are licensed under the MIT License.
See `LICENSE.txt`.

DeadSpace2008Fixes is credited to Seamus McGrath. Its complete MIT copyright and
permission notice, along with the upstream project link, is reproduced in
`THIRD_PARTY_NOTICES.txt` as required by its license.
