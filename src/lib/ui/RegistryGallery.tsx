/*
 * ui/RegistryGallery.tsx — card gallery for Registry entries.
 *
 * WHAT: Renders a paged grid of cards — one per RegistryEntry. Each card
 *       shows art (emoji or image), a label, an optional caption, optional
 *       tag chips, and an availability state. Clicking an available card
 *       invokes a verb (bridged via onVerbInvoke) or calls onEntryClick.
 *       Locked entries are shown as silhouettes; they count toward the total
 *       but reveal no spoilers.
 *
 * WHY: Wave 2E Batch A (WAVE-2E-DESIGN.md §3.7). Covers forms, items,
 *      abilities, room types, recipes — any catalog the stage wants to
 *      surface as a browsable gallery. Used by ActorPanel for inventory.
 *
 * SHAPE:
 *   interface RegistryEntry { id; label; caption?; art?; tags?; verb?; available? }
 *   interface RegistryGalleryProps extends IntrospectAware
 *     { entries; columns?; maxItems?; onEntryClick?; style? }
 *   RegistryGallery(props): ReactElement
 */

import { ReactElement, CSSProperties, useState } from "react";
import type { VerbDescriptor, InvocationResult } from "../introspect";

/** Common shape for components that surface stage verbs. */
export interface IntrospectAware {
  /** Verbs to surface. */
  availableVerbs?: VerbDescriptor[];
  /** Called when the user picks a verb. */
  onVerbInvoke?: (name: string, args?: Record<string, unknown>) => Promise<InvocationResult> | void;
  /** Optional filter applied to availableVerbs before render. */
  verbFilter?: (v: VerbDescriptor) => boolean;
  /** Disabled state while a previous invocation is in flight. */
  pending?: boolean;
}

export interface RegistryEntry {
  id: string;
  label: string;
  /** Short subtitle / tagline. */
  caption?: string;
  /** Image URL or emoji glyph. */
  art?: string;
  /** Tags / chips shown under the label. */
  tags?: string[];
  /** Verb to invoke on card click. */
  verb?: string;
  /** Whether the entry is currently usable / unlocked. Default true. */
  available?: boolean;
}

export interface RegistryGalleryProps extends IntrospectAware {
  entries: RegistryEntry[];
  /** Grid columns. Default 3. */
  columns?: number;
  /** Max entries per page. Default 9 (3×3). */
  maxItems?: number;
  onEntryClick?: (entry: RegistryEntry) => void;
  style?: CSSProperties;
}

const galleryOuter: CSSProperties = {
  fontFamily: "ui-monospace, monospace",
  fontSize: "13px",
  color: "#ccc",
  display: "flex",
  flexDirection: "column",
  gap: "8px",
};

const gridStyle = (columns: number): CSSProperties => ({
  display: "grid",
  gridTemplateColumns: `repeat(${columns}, 1fr)`,
  gap: "8px",
});

const cardBase = (available: boolean, interactive: boolean): CSSProperties => ({
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "4px",
  padding: "10px 8px",
  background: available
    ? "rgba(255,255,255,0.07)"
    : "rgba(255,255,255,0.03)",
  border: `1px solid ${available ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.06)"}`,
  borderRadius: "6px",
  cursor: interactive ? "pointer" : "default",
  filter: available ? "none" : "grayscale(0.8) opacity(0.5)",
  transition: "background 0.1s ease",
  textAlign: "center" as const,
  minWidth: 0,
});

const artStyle: CSSProperties = {
  fontSize: "24px",
  lineHeight: "1",
};

const cardLabel: CSSProperties = {
  color: "#d4d4d4",
  fontSize: "12px",
  fontWeight: "500",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  width: "100%",
  textAlign: "center",
};

const cardCaption: CSSProperties = {
  color: "#888",
  fontSize: "11px",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  width: "100%",
  textAlign: "center",
};

const tagRow: CSSProperties = {
  display: "flex",
  flexWrap: "wrap" as const,
  gap: "2px",
  justifyContent: "center",
};

const tagChip: CSSProperties = {
  background: "rgba(255,255,255,0.08)",
  borderRadius: "3px",
  padding: "0 4px",
  fontSize: "10px",
  color: "#999",
};

const paginationRow: CSSProperties = {
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  gap: "8px",
  fontSize: "12px",
  color: "#888",
};

const pageBtn = (enabled: boolean): CSSProperties => ({
  background: "none",
  border: "none",
  color: enabled ? "#aaa" : "#444",
  cursor: enabled ? "pointer" : "default",
  fontFamily: "ui-monospace, monospace",
  fontSize: "14px",
  padding: "2px 6px",
});

export function RegistryGallery(props: RegistryGalleryProps): ReactElement {
  const {
    entries,
    columns = 3,
    maxItems = 9,
    availableVerbs,
    verbFilter,
    onVerbInvoke,
    onEntryClick,
    pending = false,
    style,
  } = props;

  const [page, setPage] = useState(0);

  // Apply verb filter
  const filteredVerbs = availableVerbs
    ? verbFilter ? availableVerbs.filter(verbFilter) : availableVerbs
    : [];
  const verbNames = new Set(filteredVerbs.map((v) => v.name));

  const totalPages = Math.max(1, Math.ceil(entries.length / maxItems));
  const safePage = Math.min(page, totalPages - 1);
  const pageEntries = entries.slice(safePage * maxItems, (safePage + 1) * maxItems);

  function handleClick(entry: RegistryEntry): void {
    if (pending) return;
    const isAvailable = entry.available !== false;
    if (!isAvailable) return;

    if (onEntryClick) {
      onEntryClick(entry);
      return;
    }
    if (entry.verb && onVerbInvoke) {
      const verbEnabled =
        !availableVerbs ||
        (verbNames.has(entry.verb) &&
          (filteredVerbs.find((v) => v.name === entry.verb)?.enabled !== false));
      if (verbEnabled) {
        onVerbInvoke(entry.verb, { target: entry.id });
      }
    }
  }

  function isInteractive(entry: RegistryEntry): boolean {
    if (pending) return false;
    if (entry.available === false) return false;
    if (onEntryClick) return true;
    if (!entry.verb) return false;
    if (!availableVerbs) return !!onVerbInvoke;
    return (
      verbNames.has(entry.verb) &&
      filteredVerbs.find((v) => v.name === entry.verb)?.enabled !== false
    );
  }

  return (
    <div style={{ ...galleryOuter, ...style }}>
      <div style={gridStyle(columns)}>
        {pageEntries.map((entry) => {
          const avail = entry.available !== false;
          const interactive = isInteractive(entry);
          return (
            <div
              key={entry.id}
              style={cardBase(avail, interactive)}
              onClick={interactive ? () => handleClick(entry) : undefined}
              title={entry.caption ?? entry.label}
              onMouseEnter={(e) => {
                if (interactive) {
                  (e.currentTarget as HTMLDivElement).style.background =
                    "rgba(255,255,255,0.12)";
                }
              }}
              onMouseLeave={(e) => {
                if (interactive) {
                  (e.currentTarget as HTMLDivElement).style.background =
                    "rgba(255,255,255,0.07)";
                }
              }}
              role={interactive ? "button" : undefined}
              tabIndex={interactive ? 0 : undefined}
              onKeyDown={
                interactive
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") handleClick(entry);
                    }
                  : undefined
              }
            >
              {entry.art && <div style={artStyle}>{entry.art}</div>}
              <div style={cardLabel}>{entry.label}</div>
              {entry.caption && <div style={cardCaption}>{entry.caption}</div>}
              {entry.tags && entry.tags.length > 0 && (
                <div style={tagRow}>
                  {entry.tags.map((t) => (
                    <span key={t} style={tagChip}>{t}</span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {totalPages > 1 && (
        <div style={paginationRow}>
          <button
            style={pageBtn(safePage > 0)}
            disabled={safePage === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            aria-label="Previous page"
          >
            ◀
          </button>
          <span>
            {safePage + 1} of {totalPages}
          </span>
          <button
            style={pageBtn(safePage < totalPages - 1)}
            disabled={safePage === totalPages - 1}
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            aria-label="Next page"
          >
            ▶
          </button>
        </div>
      )}
    </div>
  );
}
