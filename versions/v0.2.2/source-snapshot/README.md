# Dead Space (2008) Vortex Extension

Version 0.2.2  
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
- Checks that the game root is genuinely writable before deployment. Vortex handles
  one permission request when Windows protects the folder, concurrent checks are
  combined, and setup stops before per-file deployment prompts if access is denied.
- Removes a single unnecessary archive wrapper folder for common root-folder mods.
- Places TexMod `.tpf` packages in `TexMod Packages` under the game folder and
  explains the remaining manual TexMod step.

## Local test installation

1. Close Vortex.
2. Remove any older 0.1.0, 0.2.0, or 0.2.1 test extension so two copies do not
   register the same game.
3. Extract this ZIP into a new folder under `%APPDATA%\Vortex\Plugins`.
   The result should look like:

       %APPDATA%\Vortex\Plugins\dead-space-2008-0.2.2\index.js
       %APPDATA%\Vortex\Plugins\dead-space-2008-0.2.2\info.json
       %APPDATA%\Vortex\Plugins\dead-space-2008-0.2.2\gameart.png

   If your Vortex build offers **Extensions > Install From File**, selecting the
   ZIP there is also suitable.
4. Start Vortex and use **Games > Scan**.
5. Confirm that Vortex finds the folder containing the original `Dead Space.exe`.
   If Windows protects that folder, approve Vortex's single access request. The
   extension then creates and removes a tiny test file to confirm deployment will
   work before any mod files are attempted.
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

Dead Space root mods must be placed beside `Dead Space.exe`. When the game is under
`Program Files`, Windows may not initially allow Vortex to write there. During game
setup the extension uses Vortex's supported writable-directory check. Vortex may
show one access request, then the extension verifies the result with a temporary
probe file and immediately removes it.

The verified path is cached for the current Vortex session, and simultaneous setup
calls share one check. If access is cancelled or cannot be granted, setup stops
before deployment begins; this prevents Vortex from asking again for every DLL or
INI in a mod. Manage the game again to retry after resolving the Windows prompt.

Many other game extensions appear seamless because their mod directory is already
writable, is under Documents/AppData, or the game library previously received the
needed access. The check normally produces no prompt on those installations.

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
- Use exactly version `0.2.2` on Nexus so it matches `info.json`.
- Keep `index.js`, `info.json`, and `gameart.png` at the archive root.
- Test on a clean Steam install and at least one EA App install before requesting
  review.

Current Vortex developer references used for this release:

- https://github.com/Nexus-Mods/Vortex/tree/master/packages/vortex-api
- https://github.com/Nexus-Mods/Vortex/wiki/How-to-package-a-game-extension
- https://github.com/Nexus-Mods/Vortex/wiki/How-to-test-a-game-extension

## Legal

This extension contains no game files, EA assets, third-party mods, TexMod binaries,
or ReShade binaries. Dead Space and related marks belong to their respective owners.
This project is an unofficial community extension and is not endorsed by Electronic
Arts or Nexus Mods.

The extension code and original package artwork are licensed under the MIT License.
