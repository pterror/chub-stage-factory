/*
 * ui/ActorPanel.tsx — compact actor summary composing the Batch A leaves.
 *
 * WHAT: A bordered card summarising one Actor: name + description, a
 *       BodyDiagram silhouette, a stack of StatBar / StatTier readouts, an
 *       inventory RegistryGallery, and (optionally) a row of action buttons
 *       for verbs that target this actor.
 *
 * WHY: Wave 2E Batch D (WAVE-2E-DESIGN.md §3.4). Tier-2 composer: it arranges
 *       BodyDiagram + StatBar + StatTier + RegistryGallery rather than owning
 *       new display primitives. The actor identity (`actorId`) is the binding
 *       that ties the stats, body, inventory, and verb targeting together.
 *
 * SHAPE:
 *   interface ActorPanelProps extends IntrospectAware {
 *     actorId; name; description?; body?; stats?; inventory?;
 *     showActions?; style?
 *   }
 *   ActorPanel(props): ReactElement
 *
 * Introspect-aware: when `showActions` is set, the panel filters
 * `availableVerbs` to verbs that can target this actor (those declaring a
 * `target` arg, or carrying `group: "actor"`) and invokes them with
 * `{ target: actorId }`. Without `availableVerbs`/`onVerbInvoke` it renders
 * the status surface only.
 */

import { ReactElement, CSSProperties } from "react";
import type { IntrospectAware } from "./introspect-aware";
import type { VerbDescriptor } from "../introspect";
import { BodyDiagram } from "./BodyDiagram";
import type { BodyDiagramProps } from "./BodyDiagram";
import { StatBar } from "./StatBar";
import { StatTier } from "./StatTier";
import type { StatTier as StatTierBand } from "./StatTier";
import { RegistryGallery } from "./RegistryGallery";
import type { RegistryGalleryProps } from "./RegistryGallery";

/** One stat surfaced in the panel. When `tiers` is supplied the stat also
 *  renders a StatTier band beneath its bar. */
export interface ActorStat {
  key: string;
  label: string;
  value: number;
  max?: number;
  tiers?: StatTierBand[];
}

export interface ActorPanelProps extends IntrospectAware {
  /** Stable actor id; used as the `target` arg when invoking verbs. */
  actorId: string;
  /** Display name (panel heading). */
  name: string;
  /** Optional one-line description under the heading. */
  description?: string;
  /** Body slots passed straight to the BodyDiagram subcomponent. Omit to
   *  hide the silhouette. */
  body?: BodyDiagramProps["slots"];
  /** Stats surfaced as StatBar (+ optional StatTier) rows. */
  stats?: ActorStat[];
  /** Inventory items shown as a compact RegistryGallery. */
  inventory?: RegistryGalleryProps["entries"];
  /** When set, render a button row for verbs targeting this actor. */
  showActions?: boolean;
  style?: CSSProperties;
}

const panel: CSSProperties = {
  fontFamily: "ui-monospace, monospace",
  fontSize: "13px",
  color: "#ccc",
  display: "flex",
  flexDirection: "column",
  gap: "10px",
  padding: "12px 14px",
  border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: "8px",
  background: "rgba(255,255,255,0.03)",
  minWidth: 0,
};

const headingStyle: CSSProperties = {
  color: "#e4e4e4",
  fontSize: "14px",
  fontWeight: 600,
};

const descStyle: CSSProperties = {
  color: "#999",
  fontSize: "12px",
  lineHeight: 1.4,
};

const bodyRow: CSSProperties = {
  display: "flex",
  flexDirection: "row",
  gap: "16px",
  alignItems: "flex-start",
  flexWrap: "wrap",
};

const statsCol: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  flex: 1,
  minWidth: "160px",
};

const sectionLabel: CSSProperties = {
  color: "#777",
  fontSize: "11px",
  letterSpacing: "0.05em",
  textTransform: "uppercase",
};

const actionRow: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "6px",
};

const actionBtn = (enabled: boolean): CSSProperties => ({
  fontFamily: "ui-monospace, monospace",
  fontSize: "12px",
  padding: "4px 10px",
  borderRadius: "4px",
  border: `1px solid ${enabled ? "rgba(100,200,100,0.4)" : "rgba(255,255,255,0.1)"}`,
  background: enabled ? "rgba(100,200,100,0.12)" : "rgba(255,255,255,0.03)",
  color: enabled ? "#9f9" : "#666",
  cursor: enabled ? "pointer" : "default",
});

/** A verb is targetable at this actor if it declares a `target` arg or is
 *  grouped under "actor". */
function targetsActor(v: VerbDescriptor): boolean {
  if (v.group === "actor") return true;
  return (v.args ?? []).some((a) => a.name === "target");
}

export function ActorPanel(props: ActorPanelProps): ReactElement {
  const {
    actorId,
    name,
    description,
    body,
    stats,
    inventory,
    showActions = false,
    availableVerbs,
    onVerbInvoke,
    verbFilter,
    pending = false,
    style,
  } = props;

  const baseVerbs = availableVerbs
    ? verbFilter
      ? availableVerbs.filter(verbFilter)
      : availableVerbs
    : [];
  const actorVerbs =
    showActions && availableVerbs ? baseVerbs.filter(targetsActor) : [];

  function handleVerb(v: VerbDescriptor): void {
    if (pending || v.enabled === false || !onVerbInvoke) return;
    void onVerbInvoke(v.name, { target: actorId });
  }

  return (
    <div style={{ ...panel, ...style }}>
      <div>
        <div style={headingStyle}>{name}</div>
        {description && <div style={descStyle}>{description}</div>}
      </div>

      <div style={bodyRow}>
        {body && body.length > 0 && (
          <BodyDiagram slots={body} layout="humanoid" />
        )}
        {stats && stats.length > 0 && (
          <div style={statsCol}>
            {stats.map((s) => (
              <div key={s.key} style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <StatBar label={s.label} value={s.value} max={s.max} />
                {s.tiers && s.tiers.length > 0 && (
                  <StatTier label={s.label} value={s.value} tiers={s.tiers} />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {inventory && inventory.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <span style={sectionLabel}>Inventory</span>
          <RegistryGallery
            entries={inventory}
            columns={3}
            availableVerbs={availableVerbs}
            onVerbInvoke={onVerbInvoke}
            verbFilter={verbFilter}
            pending={pending}
          />
        </div>
      )}

      {showActions && actorVerbs.length > 0 && (
        <div style={actionRow}>
          {actorVerbs.map((v) => {
            const enabled = !pending && v.enabled !== false && !!onVerbInvoke;
            return (
              <button
                key={v.name}
                type="button"
                style={actionBtn(enabled)}
                disabled={!enabled}
                onClick={() => handleVerb(v)}
                title={v.description ?? v.label ?? v.name}
              >
                {v.label ?? v.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
