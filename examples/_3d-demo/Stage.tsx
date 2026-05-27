/*
 * _3d-demo/Stage.tsx — Wave 2F substrate demo (internal, prefixed `_`).
 *
 * Shows the substrate working end-to-end IN BROWSER:
 *   - ThreeScene wrapper
 *   - Physics3DWorld (Rapier WASM) with a falling sphere on a tile board
 *   - TileGrid3D as a board floor (clicks teleport the sphere)
 *   - ThirdPersonRig orbiting the sphere
 *   - StageIntrospect interop (third-person:lock-on goes through invokeVerb)
 *   - defaultAssetCache (allocated but no real assets — see notes)
 *
 * Not a Chub-shipping stage; lives in `examples/_3d-demo/` (underscore
 * prefix) so `scripts/build-all-examples.mjs` and `scripts/promote-example.mjs`
 * skip it.
 *
 * Headless caveat: this Stage is browser-only. `scripts/run-stage.mjs`
 * cannot validate WebGL output in jsdom — the lifecycle methods (`load`,
 * `beforePrompt`, `afterResponse`) are exercised in the smoke harness,
 * but the actual 3D rendering must be eyeballed in `bun run dev`.
 */

import {Suspense, lazy, useEffect, useRef, useState, type ReactElement} from "react";
import {StageBase, type StageResponse, type InitialData, type Message} from "@chub-ai/stages-ts";
import type {LoadResponse} from "@chub-ai/stages-ts/dist/types/load";
import type {
  StageIntrospect,
  VerbDescriptor,
  StageDescriptor,
  InvocationResult,
} from "../../src/lib/introspect";
import {fpsRigVerbs, thirdPersonRigVerbs} from "../../src/lib/3d/camera-rigs/types";

// Lazy-load the 3D bundle at module top level (NOT inside render) per
// 3D-SCENE.md. Stages that don't render 3D never pay for the bundle.
const SceneView = lazy(() => import("./SceneView"));

interface MessageStateType {
  /** Logical tile the sphere is "sitting on" (-1 = airborne / random). */
  tile: number;
  /** Turn counter. */
  turns: number;
}

type ChatStateType = null;
type InitStateType = null;
type ConfigType = null;

export class ThreeDDemoStage
  extends StageBase<InitStateType, ChatStateType, MessageStateType, ConfigType>
  implements StageIntrospect
{
  private ms: MessageStateType;

  constructor(data: InitialData<InitStateType, ChatStateType, MessageStateType, ConfigType>) {
    super(data);
    this.ms = data.messageState ?? {tile: 0, turns: 0};
  }

  async load(): Promise<Partial<LoadResponse<InitStateType, ChatStateType, MessageStateType>>> {
    return {success: true, error: null, initState: null, chatState: null, messageState: {...this.ms}};
  }

  async setState(state: MessageStateType): Promise<void> {
    if (state) this.ms = {...this.ms, ...state};
  }

  async beforePrompt(msg: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {
    this.ms = {...this.ms, turns: this.ms.turns + 1};
    // Free-form: "tile N" → place sphere on tile N.
    const m = (msg.content ?? "").match(/tile\s+(\d+)/i);
    if (m) this.ms.tile = Math.max(0, Math.min(8, parseInt(m[1], 10)));
    return {messageState: {...this.ms}};
  }

  async afterResponse(_msg: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {
    return {messageState: {...this.ms}};
  }

  // ---- StageIntrospect ----

  availableVerbs(): VerbDescriptor[] {
    const tileVerbs: VerbDescriptor[] = Array.from({length: 9}, (_, i) => ({
      name: `place-tile-${i}`,
      label: `Place on tile ${i}`,
      group: "board",
    }));
    return [...tileVerbs, ...thirdPersonRigVerbs, ...fpsRigVerbs];
  }

  describe(): StageDescriptor {
    return {
      summary: `3D demo: turn ${this.ms.turns}, sphere on tile ${this.ms.tile}.`,
      details: {tile: this.ms.tile, turns: this.ms.turns},
      verbCount: this.availableVerbs().length,
    };
  }

  async invokeVerb(name: string, _args?: Record<string, unknown>): Promise<InvocationResult> {
    const tileMatch = name.match(/^place-tile-(\d+)$/);
    if (tileMatch) {
      const n = parseInt(tileMatch[1], 10);
      this.ms = {...this.ms, tile: n, turns: this.ms.turns + 1};
      return {ok: true, message: `placed on tile ${n}`, messageState: {...this.ms}};
    }
    if (name === "third-person:lock-on" || name === "fps:fire" || name === "fps:interact") {
      // Camera-rig verbs are no-ops at the gameplay level for this demo;
      // a real stage would do something meaningful here.
      return {ok: true, message: `camera verb: ${name}`};
    }
    return {ok: false, error: `unknown verb: ${name}`};
  }

  render(): ReactElement {
    return <StageView ms={this.ms} onTileClick={(n) => this.invokeVerb(`place-tile-${n}`)} />;
  }
}

/**
 * React component split so the 3D bundle is loaded lazily and so React
 * hooks (useState/useRef) work — class component render can't call hooks.
 */
function StageView(props: {
  ms: MessageStateType;
  onTileClick: (n: number) => void;
}): ReactElement {
  const [tile, setTile] = useState(props.ms.tile);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    setTile(props.ms.tile);
  }, [props.ms.tile]);

  useEffect(() => () => {
    mounted.current = false;
  }, []);

  const handleClick = (n: number) => {
    setTile(n);
    Promise.resolve(props.onTileClick(n)).catch((err: unknown) => {
      if (mounted.current) setError(String(err));
    });
  };

  return (
    <div style={{width: "100vw", height: "100vh", position: "relative", background: "#181820"}}>
      <Suspense fallback={<div style={{color: "white", padding: 16}}>Loading 3D…</div>}>
        <SceneView tile={tile} onTileClick={handleClick} />
      </Suspense>
      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          padding: 10,
          background: "rgba(0,0,0,0.55)",
          color: "white",
          font: "13px/1.4 system-ui, sans-serif",
          borderRadius: 4,
          pointerEvents: "none",
        }}
      >
        <div>Wave 2F substrate demo</div>
        <div>Turn {props.ms.turns} · tile {tile}</div>
        <div style={{opacity: 0.7}}>Click a tile to teleport the sphere. Drag to orbit.</div>
        {error && <div style={{color: "salmon"}}>err: {error}</div>}
      </div>
    </div>
  );
}
