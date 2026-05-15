# chub-stage-factory

A self-contained Claude Code workspace for designing and shipping a single [Chub](https://chub.ai) stage. Forked structurally from [CharHubAI/extension-template](https://github.com/CharHubAI/extension-template); the template's "clone-me" framing has been replaced by a two-phase workflow driven by `CLAUDE.md`.

## Workflow

- **Phase 1 — Co-design.** Talk through the stage idea with Claude; the conversation fills out `DESIGN.md` (identity, concept, UI, LLM interaction, state, config, tests).
- **Phase 2 — Ship.** Run `/loop`. Claude reads `DESIGN.md` + `STATUS.md` and autonomously builds the stage, ticking off the task list and recording decisions.
- `DESIGN.md` is the spec. `STATUS.md` is the running log.
- `src/Stage.tsx`, `src/TestRunner.tsx`, and `public/chub_meta.yaml` are filled in during the phases — leave them alone until then.

## Quickstart

```bash
nix develop                  # node 21 + yarn
# open this directory in Claude Code
# talk through what you want the stage to be (Phase 1)
# when DESIGN.md feels complete, say: /loop
```

See `CLAUDE.md` for the full workflow and behavioral rules.

## References

- Chub stages docs: <https://docs.chub.ai/docs/stages>
- Upstream extension template: <https://github.com/CharHubAI/extension-template>

`LICENSE.txt` carries over from the upstream extension template.
