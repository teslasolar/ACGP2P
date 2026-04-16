# /auth

Identity + sign-in subsystem.  Owns the `auth.*` namespace; each OAuth
provider owns its own sub-namespace beneath it.

```
auth/
  provider.py         top-level · owns auth.profile + auth.signedIn
  udts.json           general UDTs (Profile)
  tags.json           auth.* tag catalog
  index.html          subsystem index (rendered by /index/renderer.js)
  discord/            🎮 implicit-grant OAuth (pure browser, no proxy)
  github/             🐙 device flow (requires a CORS proxy)
  google/             🔎 OIDC implicit / id_token (stub · not wired yet)
```

## Namespace map

```
auth.profile            Profile UDT · whichever provider succeeded last
auth.signedIn           bool · derived from auth.profile
auth.discord.*          discord-specific state (client id, last token age, …)
auth.github.*           github-specific state (device code in flight, ...)
auth.google.*           google-specific state
```

## Sub-provider contract

Each provider directory follows the §0 section contract:

```
<provider>/udts.json      provider-specific UDTs (DiscordProfile, etc.)
<provider>/tags.json      auth.<provider>.* tag catalog
<provider>/provider.py    Jython 2.7 · owns auth.<provider>.*
```

A successful sign-in there writes:
  1. `auth.<provider>.profile` (their local snapshot)
  2. `auth.profile` at the top level (the canonical "who is signed in")
  3. `auth.signedIn = true`

On `logout()` the provider clears `auth.<provider>.*` AND if it was the
last-write owner of `auth.profile`, clears that too.
