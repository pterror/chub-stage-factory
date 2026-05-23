# PROSE — register doc and architecture catalog

This document is mirrored, machine-readable, in `prose-register.ts` so it can
be quoted verbatim to the LLM via `proseInstructions(...)`. Edit both
together.

## Why the stage doesn't write the prose

The LLM is the prose engine. The stage is the world model. If the stage
writes prose, the model has to decide between continuing its own voice and
mimicking yours — usually it does both, badly. If the stage emits structure
plus a register doc, the model has a job description and full ownership of
the sentence.

This is rule #9 in `README.md`. Everything in this file exists to make that
rule actionable.

## Registers (POV × tense × distance)

A register is the answer to three questions:

- **POV**: `"first"` | `"close-second"` | `"third"`
- **Tense**: `"past"` | `"present"`
- **Distance**: `"close"` (interiority constant), `"near"` (mostly external,
  brief interiority), `"wide"` (external; interiority via behaviour only)

Built-in presets in `PRESET_REGISTERS`:

| Key | POV | Tense | Distance |
|-----|-----|-------|----------|
| `close-2nd-past` | close-second | past | close |
| `close-2nd-present` | close-second | present | close |
| `1st-past` | first | past | close |
| `wide-3rd-present` | third | present | wide |

`RegisterSpec.extras: string[]` lets a stage append things like
`"no proper nouns"`, `"limit dialogue tags to 'said'"`, `"avoid the word
'feel'"`.

## Architecture catalog

Ten passage shapes. Use one or two per beat; chaining all of them produces
purple. Each is one summary plus one short example.

(The example sentences are also in code; this file is the readable copy.)

### `accumulation`

Stack short observations in series, each pulling focus further from where the
previous one ended. The reader's attention accretes; nothing resolves until
the last clause.

> Cold floor. Cold tile. Cold seam between two tiles where her toe found a
> gap of grout.

### `contrast_pair`

Two adjacent sentences (or clauses) putting a sensory or emotional pair into
direct opposition without commentary.

> The room was warm. Her hands were not.

### `zoom_out`

Begin at the body or an object; widen by one ring per sentence until the
scene boundary.

> Her thumb. The cup. The countertop. The kitchen at the wrong hour. The
> house she had agreed to.

### `fragment_cascade`

Incomplete sentences in rapid succession to mimic perception under stress or
fatigue. Use sparingly — it loses force fast.

> Door open. Light on. Wrong shoes by the wall. Not hers.

### `focus_hold`

Stay on a single small detail for two or three sentences before letting the
scene advance. The hold creates weight without exposition.

> The faucet dripped. It dripped again. Between the drips was the only quiet
> in the building.

### `body_then_world`

Open with one interoceptive cue (breath, heat, ache), then move outward to
one external cue, then back to action. Establishes embodiment before scene.

> Her jaw was clenched; she hadn't noticed. Sun on the back of her neck. She
> turned away from it.

### `appositive_fold`

Use commas to fold a noun together with its description, letting modifiers
do the work an additional sentence would otherwise carry.

> She unwrapped the parcel, the one her mother had refused to address by
> name.

### `terminal_sense_shift`

Switch sensory modality at the last clause of the paragraph. The shift
signals the next beat.

> The street, the streetlights, the late hour of the late season — and the
> metal of the railing, cold under her palm.

### `arrival_sequence`

When a character enters a space, render the entrance as: threshold cue, body
cue, then one detail that locates them in the scene's emotional weather.
Three beats; no more.

> The door closed behind her. Her shoulders dropped a quarter-inch. The
> kitchen was already full of someone else's morning.

### `conditional_inversion`

Lead with the dependent clause when it carries the weight; lead with the
main clause when the main clause is the surprise.

> If she had stayed five more minutes she would have heard him say it. She
> did not stay.

## Picking architectures per beat

A rough mapping (not law):

- **Interior shift / mood pivot** → `body_then_world`, `contrast_pair`, `focus_hold`
- **Spatial scene set** → `arrival_sequence`, `zoom_out`, `appositive_fold`
- **High-affect / disordered perception** → `fragment_cascade`,
  `terminal_sense_shift`
- **Punchline / reveal** → `conditional_inversion`, `contrast_pair`
- **Repetition / dread** → `focus_hold`, `accumulation`
