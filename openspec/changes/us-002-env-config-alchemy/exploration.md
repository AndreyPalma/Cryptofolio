## Exploration: US-002 — Env config ALCHEMY_API_KEY

### Current State

The project already has a centralized environment-validation layer (`env.ts`) and a deployment contract (`render.yaml`), plus a `.env.example` template. Four API keys are already declared: `ETHERSCAN_API_KEY`, `BSCTRACE_API_KEY`, `BINANCE_API_KEY`, `BINANCE_SECRET_KEY`. The Alchemy client (`sync/clients/alchemy.ts`) was implemented in US-001 and expects its key via the `AlchemyClientOptions.apiKey` parameter, but `ALCHEMY_API_KEY` is **not yet present** in any env schema, example file, or Render manifest.

### Affected Areas

- `apps/backend/src/env.ts` — `EnvSchema` must include `ALCHEMY_API_KEY`.
- `.env.example` — Template must document the new key for onboarding.
- `render.yaml` — Backend service `envVars` must declare the key so Render knows it exists (manual dashboard fill).
- `.env` (local, git-ignored) — Developer must add the real key manually; not tracked, but essential for local dev.
- `apps/backend/src/routes/credentials.ts` — Optional: add `ALCHEMY_API_KEY` presence to `GET /api/credentials` to stay consistent with existing pattern.
- `apps/backend/src/schemas/credentials.ts` — Optional: add `ALCHEMY_API_KEY: z.boolean()` to `CredentialsPresenceSchema`.
- `apps/backend/src/services/credential-test.ts` — Optional: add `testAlchemy()` for parity with etherscan/bsctrace/binance.

### Approaches

1. **Make `ALCHEMY_API_KEY` required in `EnvSchema`** (`z.string().min(1)`)
   - Pros: Enforces the key at boot time; no silent failures; consistent with `ETHERSCAN_API_KEY` et al.
   - Cons: Breaks existing local `.env` and Render deployments until the key is added. Server exits on startup with ZodError.
   - Effort: Low

2. **Make `ALCHEMY_API_KEY` optional in `EnvSchema`** (`z.string().min(1).optional()`)
   - Pros: Backward-compatible; existing setups keep working; `alchemyClient.assertConfigured()` still fails fast at sync time if empty.
   - Cons: Boot-time validation is weaker; developer may not notice the missing key until hitting sync.
   - Effort: Low

### Recommendation

**Approach 1 (required)** is preferred because the project is single-user and the key is a deliberate dependency introduced by US-001. The failure is immediate and obvious (ZodError on boot), which is better than a cryptic `ApiKeyMissingError` deep in a sync run. The migration cost is minimal: add one line to `.env` and one env var in Render.

### Risks

- **Boot failure on existing environments** if the key is missing. Mitigation: communicate the change clearly; update `.env.example` immediately.
- **Inconsistency with credentials UI** if `ALCHEMY_API_KEY` is added to env but not to `credentials.ts` / `schemas/credentials.ts`. The Settings page would show 4 keys instead of 5.
- **Secret exposure**: `.env` already contains real secrets (ETHERSCAN_API_KEY, BINANCE keys, DB password). Remind developers not to commit `.env`.

### Ready for Proposal

Yes. The scope is narrow and the pattern is well-established. The orchestrator should tell the user:
- Whether `ALCHEMY_API_KEY` should be required or optional.
- Whether to include the credentials-route / credential-test updates in US-002 or defer to a follow-up US.
