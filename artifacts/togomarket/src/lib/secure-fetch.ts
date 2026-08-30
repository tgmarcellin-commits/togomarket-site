const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

let csrfToken: string | null = null;
let csrfRequest: Promise<string> | null = null;

function isRequest(input: RequestInfo | URL): input is Request {
  return typeof Request !== "undefined" && input instanceof Request;
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  return (init?.method ?? (isRequest(input) ? input.method : "GET")).toUpperCase();
}

function isSameOriginApi(input: RequestInfo | URL): boolean {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const url = new URL(raw, window.location.href);
  return url.origin === window.location.origin && url.pathname.startsWith("/api/");
}

async function obtainCsrfToken(originalFetch: typeof window.fetch, force = false): Promise<string> {
  if (!force && csrfToken) return csrfToken;
  if (!force && csrfRequest) return csrfRequest;

  csrfRequest = originalFetch("/api/security/csrf-token", {
    method: "GET",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  }).then(async (response) => {
    if (!response.ok) throw new Error("Impossible d'initialiser la protection CSRF");
    const data = await response.json() as { csrfToken?: string };
    if (!data.csrfToken) throw new Error("Jeton CSRF absent");
    csrfToken = data.csrfToken;
    return csrfToken;
  }).finally(() => {
    csrfRequest = null;
  });

  return csrfRequest;
}

export function installSecureFetch(): void {
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const method = requestMethod(input, init);
    if (!UNSAFE_METHODS.has(method) || !isSameOriginApi(input)) {
      return originalFetch(input, init);
    }

    const send = async (forceRefresh: boolean): Promise<Response> => {
      const token = await obtainCsrfToken(originalFetch, forceRefresh);
      const headers = new Headers(isRequest(input) ? input.headers : undefined);
      new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
      headers.set("X-CSRF-Token", token);
      return originalFetch(input, {
        ...init,
        method,
        headers,
        credentials: init?.credentials ?? "same-origin",
      });
    };

    let response = await send(false);
    if (response.status === 403 && response.headers.get("content-type")?.includes("application/json")) {
      const clone = response.clone();
      const body = await clone.json().catch(() => null) as { code?: string } | null;
      if (body?.code === "csrf_invalid") {
        csrfToken = null;
        response = await send(true);
      }
    }
    return response;
  };
}