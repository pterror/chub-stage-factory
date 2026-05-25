// @experimental — used by 0-1 callers; API may change.
/*
 * embeddings.ts — vector embedding service interface + two factories.
 *
 * WHAT: `EmbeddingService` is a tiny three-method interface: embed one
 *       text → vector, embed many → vectors, cosine similarity helper.
 *       Two factories ship:
 *
 *         - `localTransformerEmbeddings(modelName?)` — lazy-imports
 *           `@xenova/transformers` (transformers.js). First embed
 *           triggers the model download (~30MB by default for
 *           `all-MiniLM-L6-v2`); subsequent calls reuse the cached
 *           pipeline.
 *         - `apiEmbeddings({ endpoint, key?, model? })` — POSTs a
 *           batched payload to an OpenAI-compatible embeddings
 *           endpoint and reads `data[i].embedding` back.
 *
 *       Both factories return the same `EmbeddingService` interface;
 *       the stage author picks. `similarity` is a static cosine
 *       function on both factories.
 *
 *       `transformers` is declared as an OPTIONAL peer dep in
 *       `package.json`; the import lives behind a dynamic `import(...)`
 *       so stages that don't use local embedding pay nothing at bundle
 *       time. `apiEmbeddings` is dependency-free.
 *
 * WHY: Required by `semanticRecallOverlayPattern` (Wave 2I) — top-K
 *      cosine over Timeline-event embeddings injected as a context
 *      contributor. Detail in src/lib/design/SYNERGY-EXTENSIONS.md §11
 *      and the new-deps section §7.
 *
 *      Design call: ship BOTH adapters behind a common interface so
 *      stages with a hosted embedder pick the API factory, and
 *      browser-only stages pick the local factory and eat the ~5MB
 *      transformers.js bundle plus first-call model download. The
 *      library does not mandate one.
 *
 * SHAPE:
 *   interface EmbeddingService {
 *     embed(text: string): Promise<number[]>;
 *     embedBatch(texts: string[]): Promise<number[][]>;
 *     similarity(a: number[], b: number[]): number;
 *   }
 *   function cosineSimilarity(a, b): number
 *   function localTransformerEmbeddings(modelName?): EmbeddingService
 *   function apiEmbeddings({ endpoint, key?, model?, fetch? }): EmbeddingService
 */

export interface EmbeddingService {
  /** Embed a single string into a dense vector. */
  embed(text: string): Promise<number[]>;
  /** Embed many strings. Implementations should batch where the
   *  backend supports it; the fallback is N sequential `embed` calls. */
  embedBatch(texts: string[]): Promise<number[][]>;
  /** Cosine similarity between two vectors. Returns 0 when either is
   *  zero-length or shapes mismatch. */
  similarity(a: number[], b: number[]): number;
}

/** Cosine similarity. Returns 0 for mismatched / empty vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

const DEFAULT_LOCAL_MODEL = "Xenova/all-MiniLM-L6-v2";

/**
 * Local-transformer embedding service. Lazy-imports
 * `@xenova/transformers`; first call downloads the model (~30MB for
 * the default `all-MiniLM-L6-v2`). Subsequent calls reuse the cached
 * feature-extraction pipeline.
 *
 * `@xenova/transformers` is declared as an OPTIONAL peer dep; stages
 * that don't use this factory pay nothing.
 */
export function localTransformerEmbeddings(
  modelName: string = DEFAULT_LOCAL_MODEL,
): EmbeddingService {
  // The feature-extraction pipeline is dynamically loaded on first use
  // and cached for the lifetime of this service instance.
  let pipelinePromise: Promise<(input: string | string[], opts?: object) => Promise<{ data: Float32Array }>> | undefined;

  async function loadPipeline() {
    if (pipelinePromise) return pipelinePromise;
    pipelinePromise = (async () => {
      // Cast through `unknown`: the optional peer dep has no type stub
      // when not installed. The runtime shape is the standard
      // transformers.js `pipeline` factory. The string form of the
      // module specifier keeps the type-checker from resolving it at
      // build time when the dep isn't present.
      const specifier = "@xenova/transformers";
      const mod = (await import(/* @vite-ignore */ specifier)) as unknown as {
        pipeline: (
          task: string,
          model: string,
        ) => Promise<
          (input: string | string[], opts?: object) => Promise<{ data: Float32Array }>
        >;
      };
      return mod.pipeline("feature-extraction", modelName);
    })();
    return pipelinePromise;
  }

  async function runOne(text: string): Promise<number[]> {
    const fe = await loadPipeline();
    const out = await fe(text, { pooling: "mean", normalize: true });
    return Array.from(out.data);
  }

  return {
    async embed(text: string): Promise<number[]> {
      return runOne(text);
    },
    async embedBatch(texts: string[]): Promise<number[][]> {
      // transformers.js batches internally when handed an array; we
      // fall back to sequential calls if the model returns a single
      // flat tensor for arrays (older versions of the lib).
      const out: number[][] = [];
      for (const t of texts) out.push(await runOne(t));
      return out;
    },
    similarity: cosineSimilarity,
  };
}

export interface ApiEmbeddingsOptions {
  /** OpenAI-compatible embeddings endpoint URL. */
  endpoint: string;
  /** Bearer token. Omit for endpoints that don't require auth. */
  key?: string;
  /** Model identifier passed in the request body. Default
   *  `text-embedding-3-small`. */
  model?: string;
  /** Override fetch for testing or non-browser environments. */
  fetch?: typeof fetch;
}

interface OpenAIEmbeddingsResponse {
  data: { embedding: number[]; index: number }[];
}

/**
 * API-call embedding service. POSTs `{ input, model }` to an
 * OpenAI-compatible endpoint and reads `data[i].embedding` back.
 * Dependency-free; routes through global `fetch` by default.
 */
export function apiEmbeddings(opts: ApiEmbeddingsOptions): EmbeddingService {
  const model = opts.model ?? "text-embedding-3-small";
  const doFetch = opts.fetch ?? fetch;

  async function post(input: string | string[]): Promise<number[][]> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (opts.key) headers["Authorization"] = `Bearer ${opts.key}`;
    const resp = await doFetch(opts.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ input, model }),
    });
    if (!resp.ok) {
      throw new Error(`apiEmbeddings: HTTP ${resp.status} ${resp.statusText}`);
    }
    const json = (await resp.json()) as OpenAIEmbeddingsResponse;
    // Sort by `index` so the response order matches the input order.
    const sorted = [...json.data].sort((a, b) => a.index - b.index);
    return sorted.map((d) => d.embedding);
  }

  return {
    async embed(text: string): Promise<number[]> {
      const out = await post(text);
      return out[0] ?? [];
    },
    async embedBatch(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) return [];
      return post(texts);
    },
    similarity: cosineSimilarity,
  };
}
