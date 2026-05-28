/*
 * ui/SlotPicker.tsx — persistence save-slot picker.
 *
 * WHAT: Enumerate existing save slots (label + timestamp + summary) plus a
 *       "New slot" affordance. Load, save, and optionally delete slots via
 *       verb invocations (introspect-aware path) or `onVerbInvoke`.
 *
 * WHY: Wave 2E Batch C. Was the only UI primitive in the original ROADMAP;
 *      now one of 14. Routes all three slot operations (load, save, delete)
 *      through `onVerbInvoke` so there are no dead buttons.
 *
 * SHAPE:
 *   interface SaveSlot      { id; label; savedAt?; summary?; empty? }
 *   interface SlotPickerProps extends IntrospectAware
 *     { slots; loadVerb?; saveVerb?; deleteVerb?; allowDelete?; style? }
 *   SlotPicker(props): ReactElement
 */

import { ReactElement, CSSProperties, useState } from "react";
import type { VerbDescriptor, InvocationResult } from "../introspect";

// ---- IntrospectAware ----

export interface IntrospectAware {
  availableVerbs?: VerbDescriptor[];
  onVerbInvoke?: (name: string, args?: Record<string, unknown>) =>
    Promise<InvocationResult> | void;
  verbFilter?: (v: VerbDescriptor) => boolean;
  pending?: boolean;
}

// ---- SaveSlot ----

export interface SaveSlot {
  /** Stable identifier used as the verb arg `{ slot: id }`. */
  id: string;
  /** Display name (e.g. "Slot 1"). */
  label: string;
  /** Epoch ms of last save; shown as a formatted date. */
  savedAt?: number;
  /** One-line description of the save state. */
  summary?: string;
  /** When true, the slot is empty (no data). */
  empty?: boolean;
}

export interface SlotPickerProps extends IntrospectAware {
  slots: SaveSlot[];
  /** Verb invoked on slot load. Default "load-slot". */
  loadVerb?: string;
  /** Verb invoked on slot save. Default "save-slot". */
  saveVerb?: string;
  /** Verb invoked on slot delete. Default "delete-slot". */
  deleteVerb?: string;
  /** Allow delete buttons on occupied slots. Default false. */
  allowDelete?: boolean;
  style?: CSSProperties;
}

// ---- Styles ----

const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "6px",
  fontFamily: "ui-monospace, monospace",
  fontSize: "13px",
  color: "#ddd",
};

const slotRowStyle = (empty: boolean): CSSProperties => ({
  display: "flex",
  flexDirection: "row",
  alignItems: "flex-start",
  gap: "8px",
  padding: "8px 10px",
  background: empty ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.06)",
  border: `1px solid ${empty ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.12)"}`,
  borderRadius: "4px",
});

const slotInfoStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "2px",
  flex: 1,
  minWidth: 0,
};

const slotLabelStyle: CSSProperties = {
  fontWeight: "600",
  color: "#eee",
};

const slotMetaStyle: CSSProperties = {
  fontSize: "11px",
  color: "#888",
};

const slotSummaryStyle: CSSProperties = {
  fontSize: "12px",
  color: "#aaa",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const slotActionsStyle: CSSProperties = {
  display: "flex",
  gap: "4px",
  alignItems: "center",
  flexShrink: 0,
};

const smallBtnStyle = (variant: "load" | "save" | "del", enabled: boolean): CSSProperties => {
  const colors = {
    load: { bg: "rgba(80,160,220,0.15)", fg: "#8cf", border: "rgba(80,160,220,0.3)" },
    save: { bg: "rgba(100,180,100,0.15)", fg: "#9d9", border: "rgba(100,180,100,0.3)" },
    del:  { bg: "rgba(200,80,80,0.12)",  fg: "#f99", border: "rgba(200,80,80,0.25)" },
  };
  const c = enabled ? colors[variant] : { bg: "rgba(255,255,255,0.03)", fg: "#444", border: "rgba(255,255,255,0.06)" };
  return {
    fontFamily: "ui-monospace, monospace",
    fontSize: "11px",
    padding: "3px 8px",
    background: c.bg,
    color: c.fg,
    border: `1px solid ${c.border}`,
    borderRadius: "3px",
    cursor: enabled ? "pointer" : "not-allowed",
    whiteSpace: "nowrap",
  };
};

const newSlotRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  padding: "6px 10px",
  border: "1px dashed rgba(255,255,255,0.1)",
  borderRadius: "4px",
  color: "#777",
};

const newSlotInputStyle: CSSProperties = {
  fontFamily: "ui-monospace, monospace",
  fontSize: "12px",
  padding: "3px 8px",
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "3px",
  color: "#ddd",
  outline: "none",
  flex: 1,
};

// ---- Helpers ----

function formatDate(epochMs: number): string {
  const d = new Date(epochMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---- Component ----

export function SlotPicker(props: SlotPickerProps): ReactElement {
  const {
    slots,
    loadVerb = "load-slot",
    saveVerb = "save-slot",
    deleteVerb = "delete-slot",
    allowDelete = false,
    onVerbInvoke,
    availableVerbs,
    verbFilter,
    pending = false,
    style,
  } = props;

  const [newLabel, setNewLabel] = useState("New save");

  // Determine which verbs are available.
  const verbEnabled = (name: string): boolean => {
    if (pending) return false;
    if (!availableVerbs) return true; // plain mode
    const filtered = (availableVerbs ?? []).filter(verbFilter ?? (() => true));
    return filtered.some((v) => v.name === name && v.enabled !== false);
  };

  function invoke(verbName: string, slotId: string): void {
    if (!onVerbInvoke) return;
    void onVerbInvoke(verbName, { slot: slotId });
  }

  function invokeNew(): void {
    if (!onVerbInvoke) return;
    const label = newLabel.trim() || "New save";
    void onVerbInvoke(saveVerb, { slot: `new`, label });
  }

  return (
    <div style={{ ...containerStyle, ...style }}>
      {slots.map((slot) => {
        const isEmpty = slot.empty === true;
        return (
          <div key={slot.id} style={slotRowStyle(isEmpty)}>
            <span style={{ color: isEmpty ? "#555" : "#aaa", flexShrink: 0 }}>
              {isEmpty ? "○" : "●"}
            </span>
            <div style={slotInfoStyle}>
              <span style={slotLabelStyle}>{slot.label}</span>
              {slot.savedAt !== undefined && (
                <span style={slotMetaStyle}>{formatDate(slot.savedAt)}</span>
              )}
              {slot.summary && (
                <span style={slotSummaryStyle}>"{slot.summary}"</span>
              )}
            </div>
            <div style={slotActionsStyle}>
              {!isEmpty && (
                <button
                  style={smallBtnStyle("load", verbEnabled(loadVerb))}
                  disabled={!verbEnabled(loadVerb)}
                  title={`Load ${slot.label}`}
                  onClick={() => invoke(loadVerb, slot.id)}
                >
                  Load
                </button>
              )}
              {isEmpty && (
                <button
                  style={smallBtnStyle("save", verbEnabled(saveVerb))}
                  disabled={!verbEnabled(saveVerb)}
                  title={`Save to ${slot.label}`}
                  onClick={() => invoke(saveVerb, slot.id)}
                >
                  Save
                </button>
              )}
              {!isEmpty && allowDelete && (
                <button
                  style={smallBtnStyle("del", verbEnabled(deleteVerb))}
                  disabled={!verbEnabled(deleteVerb)}
                  title={`Delete ${slot.label}`}
                  onClick={() => invoke(deleteVerb, slot.id)}
                >
                  Del
                </button>
              )}
            </div>
          </div>
        );
      })}

      {/* New-slot row */}
      <div style={newSlotRowStyle}>
        <span style={{ flexShrink: 0, color: "#6a6" }}>+</span>
        <input
          type="text"
          style={newSlotInputStyle}
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="New save name…"
        />
        <button
          style={smallBtnStyle("save", verbEnabled(saveVerb))}
          disabled={!verbEnabled(saveVerb)}
          title="Save to new slot"
          onClick={invokeNew}
        >
          Save
        </button>
      </div>
    </div>
  );
}
