/*
 * ui/introspect-aware.ts — shared IntrospectAware mix-in for ui components.
 *
 * WHAT: The single canonical definition of the prop shape every
 *       action-surfacing Wave 2E component mixes in via interface
 *       extension. Components either receive an explicit verb list +
 *       invoke callback (bridged mode) or fall back to plain mode.
 *
 * WHY: Wave 2E Batch D synthesis (WAVE-2E-DESIGN.md §2). Each Batch A/B/C
 *       file inlined its own copy of this interface (IntrospectAware /
 *       IntrospectAwareBody / IntrospectAwarePanel) to stay independently
 *       importable while batches built in parallel. With all batches
 *       merged, the duplication is consolidated here and every component
 *       imports it. See DECISIONS.md.
 *
 * SHAPE:
 *   interface IntrospectAware
 *     { availableVerbs?; onVerbInvoke?; verbFilter?; pending? }
 */

import type { VerbDescriptor, InvocationResult } from "../introspect";

/** Common shape for components that surface stage verbs. Mix in via
 *  interface extension (`interface FooProps extends IntrospectAware`). */
export interface IntrospectAware {
  /** Verbs to surface. When omitted the component renders in plain mode
   *  (its own click handlers, no verb gating). */
  availableVerbs?: VerbDescriptor[];

  /** Called when the user picks a verb. */
  onVerbInvoke?: (
    name: string,
    args?: Record<string, unknown>,
  ) => Promise<InvocationResult> | void;

  /** Optional filter applied to `availableVerbs` before render. Used by
   *  group-scoped components (e.g. a movement-only grid filters to
   *  `v.group === "move"`). */
  verbFilter?: (v: VerbDescriptor) => boolean;

  /** Disabled state while a previous invocation is in flight. Components
   *  grey out interactive surfaces when true. */
  pending?: boolean;
}
