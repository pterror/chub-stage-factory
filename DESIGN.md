# DESIGN

The spec for this stage. Filled out during Phase 1 (co-design) and treated as authoritative during Phase 2 (`/loop`).

See `DESIGN.example.md` for a filled-in example (using the `inventory` example stage as the case study).

## Identity

| Field | Value |
|-------|-------|
| Name | |
| Tagline | |
| Tags | |
| Visibility | <!-- PUBLIC \| PRIVATE \| UNLISTED --> |
| Position | <!-- ADJACENT \| NONE \| COVER \| FULLSCREEN --> |

## Concept

<!-- Two-paragraph pitch. What is this stage? What does it feel like to use? What problem does it solve / what experience does it create? -->

## User-facing UI

<!-- What does the user see and interact with? Layout, controls, affordances, visual style. -->

## LLM interaction model

- **beforePrompt behavior:** <!-- what runs before the model sees the user message? prompt injection? state inspection? -->
- **afterResponse behavior:** <!-- what runs on the model's reply? state mutation? side effects? -->
- **Parsing strategy:** <!-- how is the model's output structured/extracted? tags? JSON? regex? freeform? -->
- **Error handling:** <!-- what happens on parse failure, timeout, refusal, malformed state? -->

## State

### initState (immutable, set at chat creation)

| Field | Type | Meaning |
|-------|------|---------|
| | | |

### messageState (per-message, rewindable)

| Field | Type | Meaning |
|-------|------|---------|
| | | |

### chatState (per-chat, not rewindable)

| Field | Type | Meaning |
|-------|------|---------|
| | | |

## Config (user-tweakable)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| | | | |

## Primitives used

<!-- Which `src/lib/` modules this stage composes, and which PATTERNS.md
recipe is closest. Filled during Phase 1; consulted in Phase 2 as the first
read after DESIGN.md / STATUS.md. -->

| Primitive | Used for |
|-----------|----------|
| | |

Recipe (closest): <!-- inventory | tits-body | cyber-slot | turn-combat | buffs-effects | realtime-combat | physics | none-fits -->

## Test scenarios

<!-- 3+ specific flows for src/TestRunner.tsx. Each should describe inputs, expected state transitions, and observable output. -->

1.
2.
3.

## Out of scope

<!-- Things this stage explicitly does NOT do. Prevents Phase 2 from drifting. -->

## Open decisions resolved in Phase 1

<!-- Choices made during co-design that aren't obvious from the spec above. Record the choice and the reason. -->
