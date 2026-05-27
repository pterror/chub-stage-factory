# promote-example.mjs

Copies one example out of the chub-stage-factory into a new directory
as a self-contained single-stage repo.

## Usage

```
node scripts/promote-example.mjs <name> --out <dir> [--prune-lib] [--force]
```

### Arguments

| Argument | Required | Description |
|---|---|---|
| `<name>` | yes | Example name (must match a directory under `examples/`) |
| `--out <dir>` | yes | Target directory. Refuses to write into the source repo root. |
| `--force` | no | Overrides the "non-empty out" safety check. |
| `--prune-lib` | no | Conservative reachability-based deletion of unused `src/lib/` modules. |

## What it does

1. Copies the repo root (excluding `examples/`, `node_modules/`, `dist/`, `.git/`, `STATUS.md`, `TODO.md`, `.normalize/`) to `<out>`.
2. Overwrites `<out>/src/Stage.tsx` with `examples/<name>/Stage.tsx`.
3. Copies `chub_meta.yaml`, `scenario.yaml`, `README.md`, `test-init.json`, and `characters/` from the example into `<out>/`.
4. Removes `<out>/examples/`, `ExamplePicker.tsx`, `TestRunner.tsx`.
5. Rewrites `<out>/src/App.tsx` to the minimal single-stage form.
6. Updates `<out>/package.json`: sets `name` to `chub-stage-<name>`, drops factory-only scripts, adds `deploy` → `scripts/deploy.mjs`.
7. Deletes factory scripts from `<out>/scripts/` and writes a simplified `deploy.mjs`.
8. With `--prune-lib`: walks import graph from all non-lib source files and deletes unreachable modules under `src/lib/`.
9. Runs `bun install && bun run build` in `<out>` to verify self-consistency. Leaves `<out>` for inspection on failure.

## Examples

```sh
# Basic promote
node scripts/promote-example.mjs world-primary --out /tmp/my-stage

# Overwrite existing directory
node scripts/promote-example.mjs inventory --out /tmp/my-stage --force

# Prune unused lib modules
node scripts/promote-example.mjs world-primary --out /tmp/my-stage --prune-lib --force
```

## Deploying the promoted stage

In the promoted repo, set the env vars and run:

```sh
STAGE_ID=<your-stage-id> CHUB_AUTH_TOKEN=<token> bun run deploy
```

## Checking loop progress

From the factory root:

```sh
bun run status    # ~20-line summary: git state, STATUS.md tasks/blockers, latest deploy
```

Prints branch, uncommitted count, last 3 commits, STATUS.md active section + open TODOs (top 5) + blockers, and the latest deploy run in one line. Exit code always 0.

## Checking deploy status

From the factory or a promoted repo with `gh` configured:

```sh
bun run check-deploy          # pretty-prints latest 5 deploy.yml runs
node scripts/check-deploy.mjs # run directly
```

Exit codes: 0 = latest succeeded, 1 = failed, 2 = in progress, 3 = no runs found.
