import { vi } from "vitest";

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Stub global fetch; the handler receives the decoded request URL. */
export function stubFetch(handler: (url: string) => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (url: string) => handler(decodeURIComponent(url)));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
