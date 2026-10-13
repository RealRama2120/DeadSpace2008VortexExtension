# Building the extension

Requires Windows, PowerShell, and Node.js. Vortex supplies `vortex-api` at runtime.
The mocked regression suite does not need game files.

```powershell
.\tools\build.ps1
```

The script refuses to overwrite an existing versioned release. It checks numeric
`gameId` 1656, semantic version, author, syntax, 640 by 360 artwork below 1 MB,
exact ZIP entries, extracted hashes, and existing regression tests against the
exact packaged source. The ZIP, test report, and checksum go to `../outputs`.

The package has seven root files: `index.js`, `info.json`, `gameart.png`,
`README.md`, `CHANGELOG.md`, `LICENSE.txt`, and `THIRD_PARTY_NOTICES.txt`.
Its README comes from `docs/INSTALLATION.md`; the repository README is the
project landing page.

```powershell
node .\tests\extension.test.cjs
```

An optional read-only check of the existing EA App install is:

```powershell
node .\tests\discovery-ea.cjs
```

That check validates discovery only. It does not launch the game, deploy mods,
or change permissions. Current package verification is documented in
`docs/RELEASE-VERIFICATION.md`. Rebuilding current source does not recreate
historical ZIP bytes.
