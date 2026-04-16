# ACG · tag DB

```
db/tags.json    snapshot of the runtime tag plant — rendered as shields on README
db/udts.json    UDT index (copy of /controls/scada/00-legend.json + /providers.json)
```

## Read path (HMI)

The README uses `shields.io`'s `dynamic/json` endpoint to render live badges:

```
https://img.shields.io/badge/dynamic/json
  ?url=https://teslasolar.github.io/ACGP2P/db/tags.json
  &query=$.room.peerCount.value
  &label=peers
  &color=orange
```

Every tag in the DB follows the same shape so a JSONPath like
`$.<ns>.<key>.value` always works:

```jsonc
{
  "room": {
    "peerCount": { "value": 1, "quality": "good", "type": "Counter" }
  }
}
```

## Write path (control)

Two routes, pick one:

1. **Commit directly** — edit `db/tags.json` in a PR.  The HMI re-renders as soon
   as Pages redeploys (~60 s).
2. **File an issue** — open one of the forms under
   [`.github/ISSUE_TEMPLATE/`](../.github/ISSUE_TEMPLATE/):
   - `tag-update.yml`    — one tag path + value (writes a record)
   - `log-entry.yml`     — append to `errors.ring` (incident)
   - `control-action.yml` — request a runtime action (restart room, clear log…)

   A workflow (`.github/workflows/sync-db.yml`, stub for now) parses the
   issue body on `opened`/`edited`, merges it into `tags.json`, and commits
   back to main.  Issues are the audit log of every tag change.

## Compressed-token format (`§0`)

Every tag write can also be expressed in the dense glyph spec from
`controls/scada/00-legend.json`.  Example:

```
🏷️ room.peerCount  = 7                🟢 type:Counter  ts:now
🏷️ tracker.state   = "connected"      🟢 type:String   ts:now
🏷️ errors.count    = 12               🟡 type:Counter  ts:now-5m
```

A record in dense form:

```
📦 Peer
├─ id:       -ACG001-abc123
├─ name:     abc123
├─ emoji:    🔨
├─ state:    open
├─ channels: 1
├─ lastSeen: now
└─ 和
```

Issue bodies MAY use this form; the sync workflow parses it into the JSON
shape above.
