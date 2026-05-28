/*
 * ui/ModalPicker.tsx — generic modal wrapper for interrupting picker flows.
 *
 * WHAT: Structural modal shell that hosts a picker component (ChoiceList,
 *       RegistryGallery, SlotPicker, or any ReactElement) for interrupting
 *       flows: "Choose which item to give," "Equip from collection," etc.
 *       Backdrop click and Escape key trigger `onCancel`.
 *
 * WHY: Wave 2E Batch C. Not directly introspect-aware — the child component
 *      (ChoiceList, etc.) carries the introspect contract. ModalPicker is
 *      purely structural: open/close, title, cancel affordance.
 *
 * SHAPE:
 *   interface ModalPickerProps
 *     { open; title; children; onCancel; showCancel?; style? }
 *   ModalPicker(props): ReactElement
 */

import { ReactElement, CSSProperties, useEffect, useCallback } from "react";

export interface ModalPickerProps {
  /** Whether the modal is currently shown. */
  open: boolean;
  /** Modal title displayed in the header. */
  title: string;
  /** Picker content — typically ChoiceList / RegistryGallery / SlotPicker,
   *  but any ReactElement works. The child carries the introspect contract. */
  children: ReactElement;
  /** Called when the user cancels (Esc key or backdrop click). */
  onCancel: () => void;
  /** Show explicit Cancel button at the bottom. Default true. */
  showCancel?: boolean;
  style?: CSSProperties;
}

// ---- Styles ----

const backdropStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.6)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
};

const dialogStyle = (extra?: CSSProperties): CSSProperties => ({
  background: "#1a1a1a",
  border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: "6px",
  padding: "0",
  minWidth: "280px",
  maxWidth: "480px",
  maxHeight: "80vh",
  display: "flex",
  flexDirection: "column",
  fontFamily: "ui-monospace, monospace",
  color: "#ddd",
  boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
  ...extra,
});

const headerStyle: CSSProperties = {
  padding: "12px 16px",
  borderBottom: "1px solid rgba(255,255,255,0.1)",
  fontSize: "13px",
  fontWeight: "600",
  color: "#eee",
  flexShrink: 0,
};

const bodyStyle: CSSProperties = {
  padding: "12px 16px",
  overflowY: "auto",
  flex: 1,
};

const footerStyle: CSSProperties = {
  padding: "10px 16px",
  borderTop: "1px solid rgba(255,255,255,0.1)",
  display: "flex",
  justifyContent: "flex-end",
  flexShrink: 0,
};

const cancelBtnStyle: CSSProperties = {
  fontFamily: "ui-monospace, monospace",
  fontSize: "12px",
  padding: "5px 12px",
  background: "rgba(255,255,255,0.06)",
  color: "#bbb",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: "4px",
  cursor: "pointer",
};

// ---- Component ----

export function ModalPicker(props: ModalPickerProps): ReactElement {
  const { open, title, children, onCancel, showCancel = true, style } = props;

  // Escape key closes the modal.
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    },
    [onCancel],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, handleKeyDown]);

  if (!open) return <></>;

  return (
    <div
      style={backdropStyle}
      onClick={(e) => {
        // Cancel when clicking outside the dialog.
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div style={dialogStyle(style)} onClick={(e) => e.stopPropagation()}>
        <div style={headerStyle}>{title}</div>
        <div style={bodyStyle}>{children}</div>
        {showCancel && (
          <div style={footerStyle}>
            <button
              style={cancelBtnStyle}
              onClick={onCancel}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background =
                  "rgba(255,255,255,0.12)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background =
                  "rgba(255,255,255,0.06)";
              }}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
