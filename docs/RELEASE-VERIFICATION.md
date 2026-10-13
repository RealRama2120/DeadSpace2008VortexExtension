# Version 1.0.0 verification

Verified on October 13, 2026.

- `info.json`: author Rama2120, version 1.0.0, numeric Nexus game ID 1656.
- JavaScript syntax passed.
- Artwork is 640 by 360 PNG, below 1 MB.
- ZIP has exactly the seven expected root files; every extracted hash matches
  its source file.
- The existing 0.2.4 regression suite passed against the exact ZIP-extracted
  runtime. It covers registration, Steam/registry/drive discovery, original-game
  and remake validation, installers, and approved/cancelled/failed permission
  flows with mocked system operations.
- The same regression suite passed against the current root source.
- `index.js`, `gameart.png`, `LICENSE.txt`, and `THIRD_PARTY_NOTICES.txt` match
  the retained 0.2.6 baseline byte-for-byte.

The optional historical EA-install check could not validate its original
`C:\Program Files\EA Games\Dead Space` target because the game executable is
no longer present there. This is not fresh EA runtime or gameplay validation.
No game was launched, no mods were deployed, and no game-folder access was changed.

Current install ZIP SHA-256:

```text
0aab0096cf6a70a97b3f3234ad33b4cda6fa8224594a4958179b1018563110ba
```

Runtime `index.js` SHA-256:

```text
2a0d014af12c9cc770dd06e7f68e20b6d308a652370e260afe6ca7aae61e1639
```

Version 1.0.0 changes metadata and documentation only. Historical packages retain
their original bytes and are listed in `BACKUP_INVENTORY.md`.
