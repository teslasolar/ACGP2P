# controls/scada/gateway

🛰  **SCADA gateway** — host runtime that loads modules.  Each module owns
a tag namespace and follows the standard ACG provider contract
(`provider.py` + `udts.json` + `tags.json` + `index.html`).

This mirrors the Ignition Gateway pattern: a single host process exposes a
unified tag plant, and modules plug in to populate / consume slices of it.

```
controls/scada/gateway/
  auth/                🔑  identity module — owns auth.*
    provider.py            top-level (publishes auth.profile + auth.signedIn)
    udts.json   tags.json
    index.html             rendered via /index/renderer.js
    webrtc/               📡  cryptographic peer-id identity (passive)
    webtorrent/           🌊  tracker-based peer discovery (info_hash bearer)
    discord/              🎮  implicit-grant OAuth
    github/               🐙  device-flow OAuth (proxy required)
    google/               🔎  OIDC implicit (stub)
```

## Sibling area

The SCADA gateway also hosts:

- `controls/scada/errors/`  ⚠ — gateway log ring buffer (errors.*)

`errors/` is *adjacent* (a peer of `gateway/`) rather than nested, so the
gateway-log viewer at `/gateway-log.html` keeps its short module path.

## Future modules under `gateway/`

- `gateway/devices/`       device-driver registry (Modbus, OPC-UA, …)
- `gateway/tags/`          centralised tag CRUD + RBAC
- `gateway/audit/`         signed audit trail of every tag write
- `gateway/scheduler/`     cron-style script execution

Every module follows the same provider contract — drop one in, register it
in `/providers.json`, and the renderer picks it up automatically.
