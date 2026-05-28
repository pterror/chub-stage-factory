# CI/CD Audit — 2026-05-27

Audit of `.github/workflows/` in `pterror/chub-stage-factory`.

## Workflows

| File | Purpose |
|------|---------|
| `build-examples.yml` | Matrix build of all `examples/*/Stage.tsx` entries + lint/test/smoke on PR and push to main |
| `deploy.yml` | Build and upload to Chub API on push to main/master or tag push; also handles NPM publish on tags |

---

## Findings

### Fixed in this audit

#### Issue #2 — Deprecated action versions (deadline: June 2, 2026)

`deploy.yml` used `actions/checkout@v2` and `actions/setup-node@v2`, both deprecated and scheduled for removal June 2 2026.

**Resolution:** Updated `deploy.yml` to `actions/checkout@v4` + `oven-sh/setup-bun@v2` (Node setup replaced by Bun setup, see Issue #3).

`build-examples.yml` was already on `actions/checkout@v4` — no change needed there.

#### Issue #3 — yarn → bun migration

`deploy.yml` used `yarn install`, `yarn build`, and `yarn publish`. The project has migrated to Bun (`bun.lock` present, `build-examples.yml` already uses `oven-sh/setup-bun@v2`).

**Resolution:** Updated `deploy.yml`:
- `yarn install` → `bun install --frozen-lockfile`
- `yarn build` → `bun run build`
- `yarn build --mode lib && yarn version ... && yarn publish` → `bun run build --mode lib && bun version ... && bun publish`

---

### Needs human input / deferred by user choice

#### CHUB_AUTH_TOKEN secret is unset — deploy job intentionally fails

The `deploy.yml` "Confirm CHUB_AUTH_TOKEN is set" step exits with code 1 when the secret is absent. This is **intentional**: deploy is opt-in. The job will fail on every push until the repository owner sets the `CHUB_AUTH_TOKEN` secret in GitHub repo settings.

**Action required (human):** Add `CHUB_AUTH_TOKEN` to repo secrets when ready to enable deployment to Chub AI. Optionally also set `STAGE_ID` if the extension already exists.

This is not a bug. No graceful-skip guard was added; the hard-fail behavior is preserved as designed.

---

## Summary of changes made

| Workflow | Change |
|----------|--------|
| `deploy.yml` | `actions/checkout@v2` → `@v4` |
| `deploy.yml` | `actions/setup-node@v2` (node 21.7.1) → `oven-sh/setup-bun@v2` |
| `deploy.yml` | `yarn install` → `bun install --frozen-lockfile` |
| `deploy.yml` | `yarn build` → `bun run build` |
| `deploy.yml` | `yarn build --mode lib && yarn version ... && yarn publish` → bun equivalents |
| `build-examples.yml` | No changes — already on v4 actions and bun |

## No-op / out of scope

- `CHUB_AUTH_TOKEN` graceful-skip: explicitly rejected by user. Fail-fast on missing token is intentional.
- `STAGE_ID` fallback logic: left as-is (reads from `public/chub_meta.yaml` or creates a new extension).
