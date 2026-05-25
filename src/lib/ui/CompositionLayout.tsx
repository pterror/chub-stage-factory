import { ReactElement, useState } from "react";
import type { LayoutKind } from "../../composition/types";

interface Panel {
  id: string;
  node: ReactElement;
}

interface CompositionLayoutProps {
  layout: LayoutKind;
  panels: Panel[];
}

const panelWrapper = (node: ReactElement): ReactElement => (
  <div
    style={{
      contain: "layout size paint",
      isolation: "isolate",
      overflow: "hidden",
      width: "100%",
      height: "100%",
    }}
  >
    {node}
  </div>
);

function StackLayout({ panels }: { panels: Panel[] }): ReactElement {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
      }}
    >
      {panels.map((panel) => (
        <div
          key={panel.id}
          style={{ flex: 1, minHeight: 0, overflow: "hidden" }}
        >
          {panelWrapper(panel.node)}
        </div>
      ))}
    </div>
  );
}

function TabsLayout({ panels }: { panels: Panel[] }): ReactElement {
  const [activeId, setActiveId] = useState<string>(
    panels.length > 0 ? panels[0].id : "",
  );

  const activePanel = panels.find((p) => p.id === activeId) ?? panels[0];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
      }}
    >
      <div style={{ display: "flex", flexShrink: 0 }}>
        {panels.map((panel) => (
          <button
            key={panel.id}
            onClick={() => setActiveId(panel.id)}
            style={{
              padding: "6px 14px",
              cursor: "pointer",
              background: "none",
              border: "none",
              borderBottom:
                panel.id === activeId ? "2px solid currentColor" : "2px solid transparent",
              fontWeight: panel.id === activeId ? "bold" : "normal",
            }}
          >
            {panel.id}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        {activePanel ? panelWrapper(activePanel.node) : null}
      </div>
    </div>
  );
}

export function CompositionLayout({
  layout,
  panels,
}: CompositionLayoutProps): ReactElement {
  if (layout === "tabs") {
    return <TabsLayout panels={panels} />;
  }
  return <StackLayout panels={panels} />;
}
