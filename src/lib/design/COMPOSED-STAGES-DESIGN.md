# Composition Semantics

This document describes the open design questions and settled semantics for
the composed-stage variant of the delegator.

---

## Instance IDs

Instance IDs are free-form strings chosen by the deployment author, e.g.
`"inv1"`, `"physics"`, `"combat-east"`. They must be unique within a
composed config. IDs are used as keys in all three Chub state layers
(initState, chatState, messageState), so they are **permanent for the
lifetime of the chat**. Renaming an instance ID in a later deployment
revision orphans its state — the old key is abandoned in the database, and
the new ID starts with null state.

Recommended convention: short, lowercase, no spaces, descriptive enough
to survive future confusion. No semantic restriction beyond uniqueness.

---

## State Shape Compatibility

Single-stage chats and composed chats are **forever separate**. A single
chat started with `stage: "inventory"` stores its messageState as whatever
the inventory stage produces — a flat object or string shard. A chat started
in composed mode stores `{ inv1: <inventory-state>, phys1: <physics-state> }`.
The outer keys are instance IDs; the inner values are each stage's own state.

There is no upgrade path. If you switch a live deployment from single to
composed (or back), existing chats see null state on the new path. This is
intentional: the host passes back exactly what the stage returned; there is
no migration hook.

---

## State Conflict Semantics

Each instance's state lives under its own key in all three layers. There is
no structural cross-contamination between children. If two children both
write to `chatState`, their contributions are merged at the runner level:

```json
{ "inv1": { ...inventoryState }, "phys1": { ...physicsState } }
```

**Semantic overlap is the content's responsibility.** If two stages both
modify the same narrative variable (e.g. player HP), the composed config
author is responsible for understanding the conflict. The runner does not
resolve semantic disagreements — it only provides structural isolation.

### Future: `compositionState`

A fourth state layer — `compositionState` — is sketched as a place to hold
cross-instance shared state (e.g., a shared initiative queue, a global HP
pool) that neither child owns. This would require Chub host support and is
not implemented. The current design leaves room for it as an optional fifth
key alongside the three existing layers.

---

## Render Arbitration

Each panel body is wrapped in:

```tsx
<div style={{ contain: "layout size paint", isolation: "isolate", overflow: "hidden", width: "100%", height: "100%" }}>
  {node}
</div>
```

`contain: "layout size paint"` establishes a new layout/paint containment
context. A child stage that claims `width: 100vw; height: 100vh` will be
clipped to its panel, not the viewport. This is necessary because example
stages are written to run fullscreen; composition reuses them without
modifying their internal layout logic.

The `isolation: "isolate"` ensures stacking contexts do not bleed across
panels (z-index, filters, mix-blend-mode).

---

## LLM Coordination

Lifecycle hooks (`beforePrompt`, `afterResponse`) fan out sequentially in
`hookOrder` order (defaulting to declaration order when hookOrder is absent).
This means:

- Each child sees the **same** incoming message.
- `stageDirections` and `systemMessage` are **concatenated** across all
  children; the LLM sees contributions from every instance.
- `modifiedMessage`: the **last non-null value wins**. If multiple instances
  try to rewrite the user message, a `console.warn` is emitted for each
  overwrite. Deployment authors who need cooperative message rewriting must
  pick a single instance as the rewriter and configure the others to return
  `modifiedMessage: null`.
- `error`: **first non-null wins** and is surfaced to the user. Later errors
  are silently discarded in the current design.

There is no shared "context accumulation" across children — each instance
receives the raw message and returns its contribution independently. If an
instance needs to see another instance's output (e.g., a combat stage that
also reads inventory state), the correct architecture is a single composite
stage that owns both subsystems, not two instances in a composed config.

---

## Un-composition

Once a chat has been started in composed mode, it cannot revert to single
mode without orphaning the per-instance state shards in the database. There
is no de-composition operation. If a deployment is later changed from
composed to single (or to a different composed config with different IDs),
existing chats will see null state on the new path.

Design guidance: treat the composed config as part of the chat's permanent
identity, not a deployment-time variable. For experimentation, use separate
Chub deployments.

---

## Config shape (reference)

```yaml
# chub_meta.yaml snippet
config_schema:
  properties:
    composed_instances:
      type: array
      items: { type: string }
      description: "'<example>:<id>' entries"
    layout:
      type: string
      enum: [single, tabs, stack]
      default: single
    hook_order:
      type: array
      items: { type: string }
```

On the TypeScript side, Chub maps these fields to `data.config`. The
delegator's constructor translates them into a `DelegatorConfigComposed`
value when `layout` is `"tabs"` or `"stack"`, or when `composed_instances`
is non-empty. The `stage` field is ignored in composed mode.
