/*
 * assets.ts — GLTF/OBJ/texture loaders with caching for Wave 2F.
 *
 * WHAT: Thin wrapper around Three.js loaders (GLTFLoader, OBJLoader,
 *       TextureLoader) that:
 *         - Caches by URL so multiple components requesting the same asset
 *           share one GPU upload.
 *         - Returns Promises (no Suspense coupling) so non-R3F callers can
 *           use it too.
 *         - Tracks loaded assets so a stage can `disposeAll()` on unmount.
 *
 * WHY: R3F's `useGLTF`/`useTexture` are Suspense-based and bound to the
 *      Canvas tree. Stages frequently want to preload assets before
 *      mounting the canvas, or to load procgen-generated URLs. The
 *      AssetCache decouples loading from rendering.
 *
 * SHAPE:
 *   class AssetCache
 *     loadGLTF(url): Promise<GLTF>
 *     loadOBJ(url): Promise<Group>
 *     loadTexture(url): Promise<Texture>
 *     preload(urls: string[]): Promise<void>           // parallel
 *     getCached<T>(url): T | undefined
 *     disposeUrl(url): void
 *     disposeAll(): void
 *     stats(): { count: number; estimatedBytes: number }
 *
 *   const defaultAssetCache: AssetCache                  // shared singleton
 *
 * The default singleton is what most stages want. Construct a per-stage
 * cache only when you need to dispose assets at stage unmount independent
 * of other stages running in composition.
 */

import {
  Texture,
  TextureLoader,
  Group,
  Mesh,
  BufferGeometry,
  Material,
} from "three";
import {GLTFLoader, type GLTF} from "three/examples/jsm/loaders/GLTFLoader.js";
import {OBJLoader} from "three/examples/jsm/loaders/OBJLoader.js";

type AssetKind = "gltf" | "obj" | "texture";

interface CachedAsset {
  kind: AssetKind;
  /** The loaded asset; type narrows by `kind`. */
  value: GLTF | Group | Texture;
  /** Resolved-once promise; subsequent loads return this directly. */
  promise: Promise<GLTF | Group | Texture>;
  /** Refcount; future eviction policy may use this. */
  refs: number;
}

export class AssetCache {
  private entries = new Map<string, CachedAsset>();
  private gltfLoader: GLTFLoader | null = null;
  private objLoader: OBJLoader | null = null;
  private textureLoader: TextureLoader | null = null;

  loadGLTF(url: string): Promise<GLTF> {
    return this.loadKind(url, "gltf", () => {
      this.gltfLoader ??= new GLTFLoader();
      return loadAsync(this.gltfLoader, url);
    }) as Promise<GLTF>;
  }

  loadOBJ(url: string): Promise<Group> {
    return this.loadKind(url, "obj", () => {
      this.objLoader ??= new OBJLoader();
      return loadAsync(this.objLoader, url);
    }) as Promise<Group>;
  }

  loadTexture(url: string): Promise<Texture> {
    return this.loadKind(url, "texture", () => {
      this.textureLoader ??= new TextureLoader();
      return loadAsync(this.textureLoader, url);
    }) as Promise<Texture>;
  }

  /**
   * Preload multiple URLs in parallel. Resolves when all loads settle.
   * Determines the loader by file extension (.gltf/.glb → gltf,
   * .obj → obj, otherwise → texture).
   */
  async preload(urls: string[]): Promise<void> {
    await Promise.all(
      urls.map((u) => {
        const lc = u.toLowerCase();
        if (lc.endsWith(".gltf") || lc.endsWith(".glb")) return this.loadGLTF(u);
        if (lc.endsWith(".obj")) return this.loadOBJ(u);
        return this.loadTexture(u);
      }),
    );
  }

  getCached<T extends GLTF | Group | Texture>(url: string): T | undefined {
    const entry = this.entries.get(url);
    return entry?.value as T | undefined;
  }

  /** Dispose one asset and remove it from the cache. */
  disposeUrl(url: string): void {
    const entry = this.entries.get(url);
    if (!entry) return;
    disposeAsset(entry);
    this.entries.delete(url);
  }

  /** Dispose all cached assets. Call on stage unmount. */
  disposeAll(): void {
    for (const entry of this.entries.values()) disposeAsset(entry);
    this.entries.clear();
  }

  stats(): {count: number; estimatedBytes: number} {
    // Rough estimate: textures dominate. Three.js doesn't expose exact GPU
    // bytes, so we approximate from image dimensions × 4 (RGBA).
    let bytes = 0;
    for (const e of this.entries.values()) {
      if (e.kind === "texture") {
        const t = e.value as Texture;
        const img = t.image as
          | {width?: number; height?: number}
          | HTMLImageElement
          | undefined;
        if (img && "width" in img && "height" in img && img.width && img.height) {
          bytes += img.width * img.height * 4;
        }
      } else {
        bytes += 50_000; // placeholder per mesh asset
      }
    }
    return {count: this.entries.size, estimatedBytes: bytes};
  }

  private loadKind(
    url: string,
    kind: AssetKind,
    factory: () => Promise<GLTF | Group | Texture>,
  ): Promise<GLTF | Group | Texture> {
    const existing = this.entries.get(url);
    if (existing) {
      existing.refs++;
      return existing.promise;
    }
    const promise = factory();
    const placeholder: CachedAsset = {
      kind,
      value: undefined as unknown as GLTF | Group | Texture,
      promise,
      refs: 1,
    };
    this.entries.set(url, placeholder);
    promise.then((v) => {
      placeholder.value = v;
    });
    return promise;
  }
}

/** Promise wrapper around the legacy `loader.load(url, onLoad, onProgress, onError)` API. */
function loadAsync<T>(
  loader: {
    load: (
      url: string,
      onLoad: (v: T) => void,
      onProgress?: (e: ProgressEvent) => void,
      onError?: (e: unknown) => void,
    ) => void;
  },
  url: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (v) => resolve(v),
      undefined,
      (err) => reject(err instanceof Error ? err : new Error(String(err))),
    );
  });
}

function disposeAsset(entry: CachedAsset): void {
  const v = entry.value;
  if (!v) return;
  if (entry.kind === "texture") {
    (v as Texture).dispose();
  } else if (entry.kind === "gltf") {
    disposeScene((v as GLTF).scene);
  } else if (entry.kind === "obj") {
    disposeScene(v as Group);
  }
}

function disposeScene(root: Group): void {
  root.traverse((obj) => {
    const mesh = obj as Mesh;
    if (mesh.isMesh) {
      (mesh.geometry as BufferGeometry | undefined)?.dispose();
      const mat = mesh.material;
      if (Array.isArray(mat)) {
        for (const m of mat) (m as Material).dispose();
      } else if (mat) {
        (mat as Material).dispose();
      }
    }
  });
}

/** Shared singleton. Suitable for most stages. */
export const defaultAssetCache = new AssetCache();
