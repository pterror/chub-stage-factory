/*
 * patterns/puppet.ts — actor-piloting-another-actor (Wave 2D).
 *
 * WHAT: `puppetPattern(init)` manages the player's true-self Actor piloting a
 *       form Actor. The true-self (pilot) persists memory, inventory,
 *       relationships; the form Actor holds appearance, body, and abilities.
 *
 *   - `equip(formId)` — switch the active form.
 *   - `unequip()` — revert to piloting nothing (bare true-self).
 *   - `activeForm` / `activePilot` — current state.
 *   - `effectiveBody()` — the body the world observes: form's body when
 *     equipped, pilot's body otherwise.
 *   - `effectiveAbilities()` — form's abilities when equipped, empty otherwise.
 *     (Stage can merge pilot abilities separately.)
 *
 * WHY: Warframe-shape (#9): "player IS the Operator, but controls the Warframe."
 *      `graftingPattern` mutates the form's ability registry; `puppetPattern`
 *      decides which form is active. They are independent composers — grafting
 *      does not need to know which form is piloted, and puppet does not manage
 *      abilities.
 *
 * SHAPE:
 *   interface PuppetInit { pilot: Actor; formRegistry: PlaceholderRegistry<Form>; }
 *   interface PuppetBundle { activePilot: Actor; activeForm: Form | null;
 *     equip(formId): void; unequip(): void;
 *     effectiveBody(): Body; effectiveAbilities(): Registry<ActionDef>; }
 *   function puppetPattern(init: PuppetInit): PuppetBundle
 */

import type { Actor } from "../actor";
import type { Body } from "../body";
import { Registry } from "../registry";
import type { PlaceholderRegistry } from "../registry";
import type { ActionDef } from "../action";
import type { Form } from "./form";

export interface PuppetInit {
  /** The player's true-self Actor. Persists across form switches. */
  pilot: Actor;
  /** Form catalog from formCollectionPattern. */
  formRegistry: PlaceholderRegistry<Form>;
}

export interface PuppetBundle {
  /** The pilot Actor — always the player's true-self. */
  readonly activePilot: Actor;
  /** Currently equipped form, or null if bare (no form equipped). */
  activeForm: Form | null;
  /**
   * Equip a form from the registry. Throws if the form is locked or absent.
   * Call `unequip()` first if you need to swap while the previous is active.
   */
  equip(formId: string): void;
  /** Revert to bare true-self; active form becomes null. */
  unequip(): void;
  /**
   * The Body the world observes. Returns the form's body when equipped,
   * the pilot's body otherwise. Read-only accessor — mutations go directly
   * to the respective Actor.
   */
  effectiveBody(): Body;
  /**
   * The abilities available in the current state. Returns the form's
   * Registry<ActionDef> when equipped, an empty registry otherwise.
   * Stage authors may merge pilot-level abilities manually on top.
   */
  effectiveAbilities(): Registry<ActionDef>;
}

/**
 * Build the pilot/form split. No private state beyond the active form pointer.
 */
export function puppetPattern(init: PuppetInit): PuppetBundle {
  let activeForm: Form | null = null;

  return {
    get activePilot(): Actor {
      return init.pilot;
    },

    get activeForm(): Form | null {
      return activeForm;
    },
    set activeForm(f: Form | null) {
      activeForm = f;
    },

    equip(formId: string): void {
      if (!init.formRegistry.has(formId)) {
        throw new Error(`puppetPattern: form "${formId}" not found in registry.`);
      }
      if (init.formRegistry.isPlaceholder(formId)) {
        throw new Error(
          `puppetPattern: form "${formId}" is locked. Unlock it before equipping.`,
        );
      }
      activeForm = init.formRegistry.require(formId);
    },

    unequip(): void {
      activeForm = null;
    },

    effectiveBody(): Body {
      return activeForm?.actor.body ?? init.pilot.body;
    },

    effectiveAbilities(): Registry<ActionDef> {
      return activeForm?.abilities ?? new Registry<ActionDef>();
    },
  };
}
