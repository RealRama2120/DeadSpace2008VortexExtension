# Changelog

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
