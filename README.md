> **This repository is generated.**
> The source of truth is the PackAuth API registry. This client is assembled
> from it and pushed here, so it cannot fall behind the API it covers. Open
> issues here; send changes to the source repository, because an edit made in
> this one is overwritten by the next publish.

# @packauth/sdk

The PackAuth API client and command line.

## The one design decision

Every method on the client and every command in the CLI is **derived from
`spec/registries/api.json`** — the same registry the Worker binds its route
table to.

That is not tidiness. An SDK written by hand is a second declaration of the API
surface, and the second declaration is the one that falls behind: a method that
no longer matches its endpoint fails in a customer's build, not in ours. Here
there is nothing to fall behind. Add an operation and the method exists; remove
one and calling it is a `TypeError` at the call site rather than a 404 six weeks
later.

The `api-canonical` gate enforces it in both directions, and rejects any literal
API path appearing in the client or the CLI.

## Client

```js
import { PackAuth } from "@packauth/sdk";

const pa = new PackAuth({ token: process.env.PACKAUTH_TOKEN });

await pa.health();                                    // public, no token needed
await pa.listPacks();
await pa.getPack({ pack_id: "gcc_pack" });
await pa.createRun({ body: { manifest_id: "man_01HX7Q2T" } });
await pa.manifestMatrix({ manifest_id: "man_01HX7Q2T" });
await pa.listFindings({ query: { severity: "blocking" } });
```

Path parameters are **named, never positional**. `getPack({ pack_id })` reads at
the call site; a positional version invites the day someone swaps two arguments
and ships it.

`pa.describe()` returns every operation with its HTTP route, scope, path
parameters and summary — useful for a REPL, and what the CLI's help is built
from.

### Errors

Everything throws `PackAuthError`, carrying what you need to act:

```js
try {
  await pa.createPrintRelease({ body });
} catch (e) {
  e.status;      // 409
  e.code;        // "manifest_state_invalid"  — the API's own code, not a guess
  e.requestId;   // "req_01HX…"  — what makes a support conversation possible
  e.body;        // the full response
}
```

A scoped call with no token, or a missing path parameter, fails **before any
request is sent** — you get a clear local error instead of a 401 or a 404 to
interpret.

## CLI

```sh
packauth ops                                   # every operation, with its scope
packauth health                                # public
packauth list-packs
packauth get-pack --pack-id gcc_pack
packauth manifest-matrix --manifest-id man_01HX7Q2T
packauth create-run --body '{"manifest_id":"man_01HX7Q2T"}'
```

Auth comes from `PACKAUTH_TOKEN` or `--token`. It is never positional: a
positional secret ends up in shell history and in `ps` output.

`PACKAUTH_API_URL` overrides the base URL for a non-production environment.

### Exit codes

A script can branch on these; it cannot branch on a stack trace.

| Code | Meaning |
|---|---|
| `0` | Success |
| `2` | Your mistake — missing token, missing path parameter, unknown command |
| `3` | The API rejected the call |
| `4` | The API could not be reached |

## What this does not do yet

No retry, no pagination helper, no streaming. Each is a real feature with real
semantics to get right, and shipping a retry that silently repeats a
non-idempotent `POST` would be worse than having none. They land when they are
built, not as a stub.
