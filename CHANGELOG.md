# Changelog

## 1.0.0 - 2026-10-13

- Added numeric Nexus Mods game ID `1656` to `info.json` for automatic Vortex catalogue discovery.
- Promoted the existing 0.2.6 extension to version 1.0.0.
- Updated package documentation for the current Nexus extension publication process.
- Game discovery, deployment, permission handling, artwork, and license notices are unchanged.

## 0.2.6 - 2026-08-26

- Built this release directly from the tested version 0.2.4 extension code.
- Added the complete DeadSpace2008Fixes MIT copyright and permission notice for
  Seamus McGrath, plus an upstream project link and clear README attribution.
- Clarified the package's own MIT license and third-party notice relationship.
- Updated package and installation documentation to version 0.2.6.
- Version 0.2.5 is not used as this release's baseline. Its experimental LAA
  helper, LAA integration, and `tools` directory are not included.

## 0.2.4 - 2026-08-21

- Confirmed from a supplied Vortex 2.5.0 log that its elevated permission
  helpers repeatedly fail to load `fs-extra` and `permissions`, leaving the EA
  App game folder unchanged after the user approves access.
- Added an awaited `will-deploy` preflight. Vortex runs this hook before its
  own deployment destination checks, so the game folder is made writable
  before the repeating Vortex prompt can start, even for an already-managed
  Dead Space profile.
- Replaced Vortex's failing elevated JavaScript helpers with one direct Windows
  `icacls.exe` elevation. It grants Modify access only to the current Windows
  user and only on the validated Dead Space (2008) folder.
- Added one clear extension dialog before Windows UAC, a raw create-and-remove
  verification probe, a 30-second bounded wait, and a clean stop on cancel or
  failure.
- Compared installed community-extension patterns and target ACLs. Their root
  mod types rely on Vortex normally because their Steam library folders are
  already writable; this repair is limited to protected installs such as the
  user's EA App folder under `Program Files`.
- Expanded automated tests for the pre-deployment hook, direct writable paths,
  concurrent setup calls, approval, cancellation, elevation failure, SID and
  command targeting, and cleanup.

## 0.2.3 - 2026-08-21

- Replaced Vortex's failing `ensureDirWritableAsync` path, which can crash in an
  elevated helper on Vortex 2.5.0 and leave the folder unchanged.
- Added an unwrapped write probe so already-writable game folders activate with
  no permission dialog.
- Routed protected folders through Vortex's regular copy permission handler,
  which uses the lightweight Windows permissions module instead of the failing
  elevated `fs-extra` helper.
- Limited that recovery path to one Vortex permission dialog per check. If
  access is still unavailable afterward, setup stops cleanly without looping.
- Kept the successful per-session cache and concurrent-check coalescing from
  version 0.2.2.

## 0.2.2 - 2026-08-21

- Added Vortex's supported writable-directory check for the game root during setup.
- Added a real create-and-remove probe so deployment starts only after access has
  been verified successfully.
- Coalesced simultaneous setup checks and cached successful verification for the
  current Vortex session to avoid repeated permission requests.
- Added a clear failure notification and stopped setup before Vortex can request
  access separately for every file in a root-folder mod.
- Documented why protected `Program Files` installations may need one Windows
  approval while already-writable game libraries do not.

## 0.2.1 - 2026-08-21

- Fixed automatic discovery for the current EA App release, which does not ship
  `GL.ini` even though the Steam release does.
- Added the actual EA App registry key `Electronic Arts\Dead Space` in both Windows
  registry views.
- Added the known retail/EA uninstall registration as another install-path source.
- Replaced the `GL.ini` requirement with original streamed-data and chapter-folder
  validation while retaining explicit Dead Space (2023) rejection.

## 0.2.0 - 2026-08-21

- Added discovery across all mounted Windows drive letters.
- Added bounded checks for common and custom EA App, EA Games, Origin, Electronic
  Arts, and Steam library layouts.
- Expanded 32-bit, 64-bit, machine, and user registry path/value coverage.
- Validated every automatic candidate using original Dead Space (2008) files.
- Explicitly rejected the Dead Space (2023) `Data/Win32` layout and oversized remake
  executable.
- Added root-folder installer handling for DLL, INI, ASI, fix, and ReShade archives.
- Added safe removal of a single packaging-only wrapper folder.
- Added TexMod `.tpf` routing and an in-app runtime-injection warning.
- Added discovery failure guidance and game-activation modding help.
- Reworked user, testing, troubleshooting, and Nexus submission documentation.
- Added new original, text-free 640 x 360 game art.

## 0.1.0

- Initial test release with Steam and limited EA/Origin detection.
