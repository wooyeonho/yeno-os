# Browser decision provider routing (fail-closed)

This slice adds a read-only provider-routing contract for the existing browser-decision and Browser Harness paths. It does not call a provider, start Chrome, or grant browser authority.

## Contract

`GET /api/browser/providers` returns:

- `typesafe-jev`: the only provider that may be selected for typed browser decisions.
- `openai`, `anthropic`, `gemini`, `xai` (Grok), `moonshot` (Kimi), and `nvidia`: configuration status only. Generic text providers are never coerced into a typed Jev response.
- `route.authorizesCall: false` always.

A Jev route is `configured` only when all of the following are present:

- `YENO_JEV_BASE_URL` (HTTPS URL without credentials, query, or fragment)
- `YENO_JEV_API_KEY`
- `YENO_JEV_MODEL`
- `YENO_JEV_OFFICIAL_ENDPOINT_CONFIRMED=true`

The value of the key is never returned or persisted. `configured` is not a live health check and does not mean the official endpoint is reachable.

The currently inspected public material is:

- [TypeSafe introduction](https://docs.typesafe.ai/introduction)
- [browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast)

Those sources describe typed decisions and a Python/uv Browser Harness setup, but they do not provide a confirmed BLACKHOLE Node endpoint or owner credential. Therefore this repository does not guess one.

## What remains live

A later owner-approved acceptance must inject the reviewed Browser Harness transport and a real typed Jev adapter. It must prove:

1. public HTTPS fetch and DNS/private-network protections;
2. typed Jev response parsing;
3. read-only action execution;
4. deterministic and independent semantic gates;
5. durable job and phone readback.

Until then the route is a safe status/contract surface only. Synthetic tests must remain labelled synthetic.