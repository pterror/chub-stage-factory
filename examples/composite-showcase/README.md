# composite-showcase — Maven's clinic

A single stage that drives **shop -> equip -> combat** through every
major primitive. The LLM speaks all of the following tags:

| tag | effect |
|---|---|
| `<install>id</install>` | apply a TransformationDef to the body |
| `<equip>id</equip>` | bolt cyberware on (subject to tag constraints) |
| `<unequip>slot</unequip>` | remove cyberware |
| `<take>id</take>` | move an item from counter/locker to pocket |
| `<start_combat>true</start_combat>` | shop -> combat mode |
| `<action>swing|hack</action>` | combat round selection (hack requires jacked-in-capable tag) |

## Primitives composed

body, transformation, equipment, inventory, action, combat-turn, effects,
observation, prose-register, tag-parser, chub-adapters, rng. The
equipment grants flow back into combat as EffectDefs (reflex_booster ->
fast-twitch -> +dodge), so a buying decision in shop mode visibly
matters in combat mode.

## PATTERNS.md recipe

Composite of §1 + §2 + §3 + §4 + §5. See `lib/PATTERNS.md` for the
individual recipes.

## Authoring notes

Stage ~330 LOC. Per-mode observation source set: shop adds inventory +
catalog, combat adds combatant array + last events. Single `beforePrompt`
emits one prose-register + observation block tailored to the current mode.
