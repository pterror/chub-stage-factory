/*
 * patterns/form.ts — Form-as-character bundle (Wave 2D).
 *
 * WHAT: `formPattern(init)` assembles a Form — a complete character-in-its-own-
 *       right composed from Body + Stats + abilities (ActionDef set) + aesthetics
 *       metadata + lore text. A Form is not a body delta; it is a pilotable
 *       entity with its own appearance, capabilities, and narrative identity.
 *
 * WHY: Warframe-shape (#9) needs Forms as first-class pilotable objects. The
 *      stage author describes each Form declaratively; `formPattern` wires the
 *      Body, Stats, and ActionDef registry without the stage needing to manage
 *      cross-primitive plumbing. `puppetPattern` then pilots the Form actor on
 *      behalf of the player's true-self.
 *
 * SHAPE:
 *   interface FormAesthetics { displayName; description?; colorPrimary?;
 *                              colorSecondary?; iconTag?; }
 *   interface FormLore { origin?; faction?; archetype?; proseRegister?; }
 *   interface FormInit { id; body; stats; abilities; aesthetics; lore?; }
 *   interface Form { id; actor: Actor; abilities: Registry<ActionDef>;
 *                    aesthetics: FormAesthetics; lore: FormLore; }
 *   function formPattern(init: FormInit): Form
 */

import { Actor, type StatName } from "../../actor";
import type { Body } from "../../body";
import type { Stat } from "../../stats";
import type { ActionDef } from "../../action";
import { Registry } from "../../registry";

export interface FormAesthetics {
  /** Player-facing name shown in UI. */
  displayName: string;
  /** Short description of the form's role / feel. */
  description?: string;
  /** Primary theme colour (CSS string or tag). */
  colorPrimary?: string;
  /** Secondary theme colour. */
  colorSecondary?: string;
  /** Tag or icon key for the gallery card. */
  iconTag?: string;
}

export interface FormLore {
  /** In-world origin (how the form came to exist). */
  origin?: string;
  /** Faction/group affiliation. */
  faction?: string;
  /** High-level narrative archetype: "tank", "stealth", "support", etc. */
  archetype?: string;
  /**
   * Prose-register hint for LLM calls while this form is active.
   * Paste into the stage's textGen / proseInstructions contributor.
   */
  proseRegister?: string;
}

export interface FormInit {
  /** Stable identifier. Must be unique within the stage's FormCollection. */
  id: string;
  /** Pre-built Body instance for this form's appearance and body tags. */
  body: Body;
  /** Stats that define this form's numerical capabilities. */
  stats: Iterable<[StatName, Stat]> | Record<StatName, Stat>;
  /** Ability definitions available to this form. */
  abilities: Iterable<[string, ActionDef]> | Record<string, ActionDef>;
  aesthetics: FormAesthetics;
  lore?: FormLore;
}

/**
 * A pilotable character bundle. All state lives on the primitives;
 * `Form` is a named grouping that `formCollectionPattern`,
 * `puppetPattern`, and `graftingPattern` operate over.
 */
export interface Form {
  id: string;
  /** The Actor instance that carries this form's body, stats, and identity.
   *  `puppetPattern` equips the player's true-self into this actor. */
  actor: Actor;
  /** Abilities registered on this form. `graftingPattern` injects into this. */
  abilities: Registry<ActionDef>;
  aesthetics: FormAesthetics;
  lore: FormLore;
}

function asAbilityMap(
  src: Iterable<[string, ActionDef]> | Record<string, ActionDef>,
): Iterable<[string, ActionDef]> {
  if (Symbol.iterator in (src as object)) return src as Iterable<[string, ActionDef]>;
  return Object.entries(src as Record<string, ActionDef>);
}

/**
 * Assemble a Form from its constituent parts. No state of its own;
 * all fields are accessible directly on the returned bundle.
 */
export function formPattern(init: FormInit): Form {
  const actor = new Actor({
    id: init.id,
    name: init.aesthetics.displayName,
    body: init.body,
    stats: init.stats,
  });

  const abilities = new Registry<ActionDef>(asAbilityMap(init.abilities));

  return {
    id: init.id,
    actor,
    abilities,
    aesthetics: init.aesthetics,
    lore: init.lore ?? {},
  };
}
