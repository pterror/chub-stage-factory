const CHUB_PROXY_TARGETS: Array<{ host: string; prefix: string }> = [
  { host: "inference.chub.ai", prefix: "/chub-proxy" },
  { host: "api.chub.ai", prefix: "/chub-api-proxy" },
];

function rewriteUrl(input: RequestInfo | URL): RequestInfo | URL {
  if (typeof input !== "string" && !(input instanceof URL)) {
    return input;
  }

  const url = typeof input === "string" ? input : input.toString();

  for (const { host, prefix } of CHUB_PROXY_TARGETS) {
    const marker = `://${host}`;
    const index = url.indexOf(marker);
    if (index !== -1) {
      const rest = url.slice(index + marker.length);
      return `${prefix}${rest}`;
    }
  }

  return input;
}

export function patchFetch(): void {
  if (typeof window === "undefined" || !window.fetch) {
    return;
  }

  const originalFetch = window.fetch.bind(window);

  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const rewritten = rewriteUrl(input);
    return originalFetch(rewritten as RequestInfo | URL, init);
  }) as typeof window.fetch;
}
