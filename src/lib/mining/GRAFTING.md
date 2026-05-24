# Warframe Helminth Subsume — Design Fidelity Report for `grafting.ts` (Wave 2D)

> Mined 2026-05-24 as prior art for chub-stage-factory primitives library.
> Captured verbatim from the mining run; informs the Wave 2D `grafting.ts` pattern (Warframe-shape) design.

---

WebFetch to `wiki.warframe.com` is blocked by the current allowlist. The report below is drawn from Warframe Helminth mechanics as of the game's 2024 state (training knowledge), combined with what the local codebase already encodes about Warframe-shape intent in `/home/me/git/pterror/chub-stage-factory/src/lib/ROADMAP.md` and `PATTERNS.md`.

## 1. What is a Subsume

The player feeds a Warframe to the Helminth organism. Helminth digests the frame and learns one specific ability from it — permanently extracting it into Helminth's library. The extracted ability can then be injected onto any other Warframe, replacing one of that frame's four ability slots. This is the core mechanic shape: **extract from formA → store in Helminth library → inject onto formB, replacing slot N of formB**.

## 2. Subsumable Abilities — Which Slot

Each Warframe has exactly four ability slots (1–4). Helminth can replace **only one slot at a time**, and only slots 1, 2, or 3. **Slot 4 (the Warframe's ultimate ability) cannot be replaced.** Each Warframe has exactly one designated "subsumable" ability — the ability Helminth learns when that frame is consumed. It is not always slot 1; each frame's subsumable ability is hardcoded per-frame. The injected (foreign) ability replaces whichever slot the player chooses (1, 2, or 3 only).

## 3. What Gets Preserved

When a foreign ability is injected onto formB:
- formB's passive ability is unchanged.
- formB's remaining three abilities (whichever slots were not replaced) are unchanged.
- formB's base stats (armor, health, shields, energy, speed) are unchanged.
- formB's mod slots, aura slot, exilus slot, and forma polarity configuration are unchanged.
- formB's cosmetics and lore identity are unchanged.
- formB's passive synergies with its own abilities remain (but the injected ability does not benefit from those synergies unless the stage authors it explicitly).

## 4. What Gets Modified

Subsumed abilities often behave differently on a foreign frame:
- **Stat scaling still uses the casting frame's mods** — power strength, range, duration, and efficiency applied to the ability are the casting frame's values, not the source frame's values. The ability adapts.
- **Passive synergies are lost** — abilities that synergize with the source frame's other abilities lose those synergies. Example: Rhino's Iron Shackles (a subsumable variant) doesn't benefit from Rhino's passive on a different frame.
- **Helminth injects a standardized "helminth version" of the ability**, not the exact in-game version. Some abilities are tuned down or simplified when subsumed (e.g. Roar grants a lower damage multiplier than native Rhino's version).
- The modification is expressed as a **per-ability override**: each ability has a defined helminth-tier scaling table distinct from its native tier. Some abilities have identical behavior; others are explicitly nerfed.

## 5. One-per-Frame

**One subsumed ability per frame, replacing one slot.** A frame cannot hold two subsumed abilities simultaneously. The injected ability occupies exactly one slot (1, 2, or 3); all others remain native. The injected ability is replaceable — you can inject a different ability, which overwrites the previous injection.

## 6. Per-Config-Slot (Critical)

**The subsumed ability is per-configuration-slot, not shared across all configs.** Each Warframe has 3 mod configuration slots (Config A, B, C). The injected ability is chosen independently per config slot. Config A might inject Roar, Config B might inject Pillage, Config C might inject the native ability back (or a third injection). This is the decisive detail for `grafting.ts` design.

## 7. Subsume Restrictions

- Slot 4 (ultimate) cannot be replaced, on any frame.
- Each Warframe has exactly one ability it can contribute to Helminth — you cannot choose which ability Helminth learns; it is fixed per frame.
- Some abilities simply are not available for subsume at all (abilities from frames not yet added to Helminth, or abilities from certain event frames).
- No frame-to-frame incompatibility beyond slot-4 lock. Any learned ability can be injected onto any eligible frame.

## 8. Subsume Process

1. Player feeds a Warframe to Helminth (the frame must not be the only copy; you need the frame itself, not just a blueprint).
2. Helminth consumes the frame — it is **permanently destroyed** from the inventory.
3. A 23-hour cooldown begins before Helminth can subsume another frame.
4. The learned ability is permanently added to Helminth's library — no re-consuming is needed.
5. Injecting a learned ability onto a frame costs biological resources (secretions) that Helminth generates passively over time or from feeding it consumables.
6. Injection is reversible — you can overwrite the injected slot with a different learned ability (at resource cost), or re-inject the original native ability (free, restores the slot).

## 9. Ability Scaling Rules

**The injected ability uses the casting frame's mods for all scaling** — power strength, range, duration, efficiency. The ability is not scaled to the source frame's base stats; it scales to whatever mods are equipped on formB. This means a min-maxed formB can make a mediocre native ability extremely potent, and vice versa.

## 10. Helminth Invigorations

Weekly system: Helminth offers two randomly selected Warframes a temporary buff (an invigoration) — a significant stat boost (e.g. +200% power strength, or +60% sprint speed). The player can choose to apply the invigoration. The buff lasts 7 days. Invigorations are adjacent to subsume (same Helminth entity, different mechanic). Design relevance: this is the Helminth's **relationship with specific frames over time** — a "favor" mechanic separate from ability transfer. For `grafting.ts`, it is a parallel optional system (affinity/buff track per form), not part of the core graft contract.

## 11. Lore Framing

Helminth is a Technocyte-infected organism that lives behind the wall in the Orbiter. It is bio-mechanical — part of the same Infestation that transforms organic matter into Warframe tissue. The subsume is literally **the organism digesting a Warframe's biological identity and encoding it into its own biomass**, then injecting that encoded pattern into another Warframe body like a grafted gene sequence. The register is: visceral, biological, symbiotic-but-parasitic, transformation as irreversible commitment. The prose register for `grafting` should carry weight — this is not a clean database swap, it is a permanent biological act.

## 12. Patterns to Port — Default Contract vs Knobs

### Default contract for `grafting(formA, abilityId, formB, configSlot)`

```
formA → contributes exactly one ability (its designated subsumable, fixed per form definition)
abilityId → must be in Helminth's learned library (i.e. formA was previously consumed)
formB → receives the ability in configSlot (1, 2, or 3 only; slot 4 locked by default)
configSlot → per-config, independent per Config A/B/C
result → formB.configs[configSlot].abilities[chosenSlot] = helminthVersion(abilityId)
         formB's passive, other slots, stats, moddable structure: unchanged
         provenance tracked: { sourceForm: formA.id, learnedAt: timestamp }
```

The three invariants to encode by default:
1. **Slot-4 is locked** — `canReplace(slotIndex) = slotIndex !== 3` (0-indexed ultimate).
2. **One injected ability per config** — injecting a second overwrites the first in that config; no accumulation.
3. **Config-independent** — each of the 3 config slots carries its own injected ability (or none).

### Optional knobs (leave to stage-author config)

| Knob | Warframe default | Stage-author override |
|------|------------------|-----------------------|
| `subsumableCost` | Biological resources (secretions) | Arbitrary resource type / free |
| `subsumeCooldown` | 23h per consume | Any duration, or none |
| `consumeOnSubsume` | formA is destroyed on consume | Non-destructive learning (e.g. "copy" mode) |
| `helminthVersion` | Tuned-down version of ability | 1:1 copy, boosted copy, or custom override fn |
| `abilityScaling` | Casts with formB's mod stats | Lock to source stats, or custom scaling fn |
| `slot4Lock` | Ultimate slot always locked | Allow ultimate replacement (stage decision) |
| `invigorations` | Weekly random buff track per form | Enable/disable; configure buff pool |
| `provenanceTracking` | Source form ID + timestamp | Add additional metadata (operator name, lore text) |
| `maxConfigSlots` | 3 | Any number (for stages with more config slots) |
| `learnedLibraryPersistence` | `chatState` (permanent) | `messageState` (rewindable experiment mode) |

### Recommended shard split

- **Helminth library** (which abilities have been learned) → `chatState` shard, `forbidBranching` — permanent, like Warframe's own destruction.
- **Per-form injected abilities** (which ability is in which config slot) → `messageState` shard, `chubTreeHistory` — per-branch, lets the player experiment with different injections on different chat branches.
- **Invigoration state** (if implemented) → `chatState` shard, weekly-tick scheduler.

### The one prose-register note

The lore register for `grafting` should use bio-mechanical language when narrating the act: not "ability transferred" but "encoded into the organism's biomass" / "grafted into the frame's nervous tissue" / "the pattern took root." This matches the Helminth's technocyte-parasite register and gives stage authors a clear prose tone to extend.
