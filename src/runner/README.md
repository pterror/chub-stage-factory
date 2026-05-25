# Runner — Browser Host + CLI Smoke Runner

Phase 4 of the stage factory adds two complementary tools for hosting and testing
Chub stages outside of Chub itself.

## Two modes

### Browser host (`runner/index.html`)

A Vite dev page that loads any Chub stage bundle into an iframe and drives it
interactively. Served by `bun run runner` (starts the Vite dev server; navigate to
`/runner/`).

URL params:
- `?bundle=<url>` — URL of the stage JS bundle to load into the iframe.
- `?scenario=<name>` — Pre-select a scenario from `scenarios/*.json`.

Features:
- Control bar: bundle URL input, scenario dropdown, step/auto-run/reset buttons,
  mock mode toggle.
- Iframe panel: hosts the stage bundle in a sandboxed iframe.
- Inspector tabs: State / Messages / Mocks.
  - **State** — live JSON of `messageState`, `chatState`, `initState`.
  - **Messages** — timestamped postMessage log with direction arrows.
  - **Mocks** — current mock mode per service; fixture list in record-replay mode.

**Third-party-bundle constraint**: the browser host can load *any* Chub-compatible
bundle (yours or a third party's) because it communicates purely via the postMessage
protocol. The CLI runner, by contrast, imports the stage class directly and therefore
only works with stages built from this repo.

### CLI smoke runner (`scripts/run-stage.mjs`)

```sh
node scripts/run-stage.mjs <example-name> --scenario scenarios/world-primary.smoke.json
node scripts/run-stage.mjs world-primary --scenario scenarios/world-primary.smoke.json --turns 3
node scripts/run-stage.mjs world-primary --scenario scenarios/world-primary.smoke.json --interactive
node scripts/run-stage.mjs world-primary --scenario scenarios/world-primary.smoke.json --print-html
```

Requires the headless ESM build (`bun run build:headless` → `dist-headless/index.js`).
Uses jsdom for DOM rendering so `domContains`/`domMatches` assertions work.
Exit 0 on success, 1 on assertion failure.

Run all smoke scenarios:
```sh
bun run test:smoke
```

## Scenario format

Scenarios live in `scenarios/*.json`.

```json
{
  "name": "my scenario",
  "init": { /* InitData — merged with defaults */ },
  "steps": [
    { "type": "before", "message": { "content": "Hello" } },
    { "type": "after",  "message": { "content": "Response" } },
    { "type": "set",    "state": { "hp": 10 } },
    { "type": "call",   "functionName": "myMethod", "args": {} }
  ],
  "assertions": [
    { "kind": "messageState", "path": "player.hp", "expected": 10, "when": "end" },
    { "kind": "chatState",    "path": "flags.visited", "expected": true, "when": "always" },
    { "kind": "domContains",  "selector": "div.scene",  "when": "end" },
    { "kind": "domMatches",   "selector": "div",  "pattern": "HP: \\d+", "when": "end" }
  ]
}
```

### Step types

| type | fields | effect |
|------|--------|--------|
| `before` | `message: BeforeData` | calls `stage.beforePrompt(message)` |
| `after`  | `message: AfterData`  | calls `stage.afterResponse(message)` |
| `set`    | `state: unknown`      | calls `stage.setState(state)` |
| `call`   | `functionName, args?` | calls `stage[functionName](args)` |

### Assertion kinds

| kind | fields | check |
|------|--------|-------|
| `messageState` | `path, expected` | dot-notation into last `messageState` |
| `chatState`    | `path, expected` | dot-notation into last `chatState`    |
| `domContains`  | `selector`       | rendered HTML contains the string     |
| `domMatches`   | `selector, pattern` | rendered HTML matches regexp       |

`when` defaults to `"end"` (checked once after all steps). Use `"always"` to check
after every step.

## Mock modes

| mode | description |
|------|-------------|
| `null` | Deterministic canned responses — no I/O. Default. |
| `passthrough` | Forward to a real endpoint. Configure URL via `VITE_PASSTHROUGH_URL` (browser) or `PASSTHROUGH_URL` (Node). |
| `record-replay` | Key by `(methodName, JSON(args))`. Replays recorded fixtures; records new ones. CLI: fixtures in `scenarios/fixtures/`. |
