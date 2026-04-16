# /controls

Control-plane subsystems.  One directory per control facility — each owning
its own tag namespace(s), UDTs, Jython 2.7 provider, and subsystem index.

```
controls/
  scada/             🖥️  tag plant · HMI monitor · dense-token specs (§0 — §4)
```

Siblings (future — room here for more):

- `controls/alarm/`        alarm engine + journal
- `controls/schedule/`     cron-like scheduling of broadcasts / re-announces
- `controls/routing/`      rule-based tag routing + transformations
- `controls/pinning/`      "pinned tags" (persist across sessions)

Every control subsystem follows the same contract as /chat, /auth, /errors,
/sandbox (see `/index/README.md`): `provider.py` (Jython 2.7) + `udts.json`
+ `tags.json` + `index.html` → rendered via `/index/renderer.js`.
