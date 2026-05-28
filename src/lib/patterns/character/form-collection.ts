/*
 * patterns/form-collection.ts — PlaceholderRegistry<Form> with unlock
 *                                progression (Wave 2D).
 *
 * WHAT: `formCollectionPattern(init)` wraps a `PlaceholderRegistry<Form>`,
 *       providing:
 *         - A pre-seeded catalog of placeholder Forms (e.g. procgen stubs
 *           swapped for real Forms once generated).
 *         - `unlock(id, form)` — resolve a placeholder to a real Form, or
 *           register a new Form directly.
 *         - `locked(id)` — whether a Form is still a placeholder.
 *         - `unlocked()` — all Forms that have been resolved.
 *         - `all()` — all registered ids (locked + unlocked).
 *         - The underlying `registry` for callers that need full access.
 *
 * WHY: Warframe-shape (#9): the catalog starts with locked Forms (placeholder
 *      stubs); defeating enemies / completing missions drops the real Form that
 *      resolves the placeholder. `graftingPattern` takes a
 *      `PlaceholderRegistry<Form>` directly, so this bundle composes cleanly
 *      into the full Warframe stack.
 *
 * SHAPE:
 *   interface FormCollectionInit { forms?: Iterable<Form>; placeholders?: string[]; }
 *   interface FormCollection { registry: PlaceholderRegistry<Form>;
 *     unlock(id, form): void; locked(id): boolean;
 *     unlocked(): Form[]; all(): string[]; get(id): Form | undefined; }
 *   function formCollectionPattern(init?: FormCollectionInit): FormCollection
 */

import { PlaceholderRegistry } from "../../registry";
import type { Form } from "./form";

export interface FormCollectionInit {
  /**
   * Fully-resolved Forms to register immediately.
   * Typically the forms the player starts with.
   */
  forms?: Iterable<Form>;
  /**
   * IDs to register as placeholders (locked forms — not yet acquired).
   * The placeholder value is a minimal sentinel used only to reserve the slot;
   * `unlock` replaces it with the real Form.
   */
  placeholders?: Iterable<string>;
}

/**
 * A managed collection of Forms with unlock progression.
 * All state lives in `registry`; the bundle methods are convenience helpers.
 */
export interface FormCollection {
  /** The underlying registry — pass to `graftingPattern`. */
  registry: PlaceholderRegistry<Form>;
  /**
   * Resolve a placeholder to a real Form, or register a brand-new Form.
   * If `id` was not previously registered, this is a normal registration.
   */
  unlock(id: string, form: Form): void;
  /** True if the id is registered as a placeholder (not yet acquired). */
  locked(id: string): boolean;
  /** All resolved (non-placeholder) Forms. */
  unlocked(): Form[];
  /** All registered ids (locked + unlocked). */
  all(): string[];
  /** Look up a Form by id. Returns undefined if not registered or locked. */
  get(id: string): Form | undefined;
}

/**
 * A sentinel Body/Actor placeholder: the minimum valid Form stub.
 * Stage authors should not read values from locked Forms — check
 * `locked(id)` before using any Form returned from `registry.get`.
 */
function sentinelForm(id: string): Form {
  // Lazy import avoided: Body is already transitively present via form.ts.
  // We construct the minimal stub without importing body directly by relying
  // on formPattern's Actor constructor; here we inline a minimal object
  // because importing formPattern would create a circular dep chain.
  // Stage authors never inspect placeholder forms; this is only a registry slot.
  return {
    id,
    // Cast: the Actor constructor requires body, but we stub all fields.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    actor: null as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    abilities: null as any,
    aesthetics: { displayName: `[Locked: ${id}]` },
    lore: {},
  };
}

/**
 * Build a Form catalog with unlock progression.
 * The returned `registry` is the direct dependency for `graftingPattern`.
 */
export function formCollectionPattern(init: FormCollectionInit = {}): FormCollection {
  const registry = new PlaceholderRegistry<Form>();

  // Register real forms up front.
  if (init.forms) {
    for (const form of init.forms) registry.register(form.id, form);
  }

  // Seed locked slots.
  if (init.placeholders) {
    for (const id of init.placeholders) {
      registry.registerPlaceholder(id, sentinelForm(id));
    }
  }

  return {
    registry,

    unlock(id: string, form: Form): void {
      registry.register(id, form);
      // PlaceholderRegistry.register overwrites the placeholder flag.
    },

    locked(id: string): boolean {
      return registry.has(id) && registry.isPlaceholder(id);
    },

    unlocked(): Form[] {
      return registry
        .entries()
        .filter(([id]) => !registry.isPlaceholder(id))
        .map(([, form]) => form);
    },

    all(): string[] {
      return registry.keys();
    },

    get(id: string): Form | undefined {
      if (registry.isPlaceholder(id)) return undefined;
      return registry.get(id);
    },
  };
}
