import { vi } from "vitest";

export interface AlchemyFixture {
  requestMatcher: (url: string, body: unknown) => boolean;
  response: Response | (() => Response);
}

const fixtures: AlchemyFixture[] = [];

export function mockAlchemy(fixture: AlchemyFixture): void {
  fixtures.push(fixture);
}

export function setupMockFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      const bodyStr = typeof init.body === "string" ? init.body : JSON.stringify(init.body);
      const body = bodyStr ? (JSON.parse(bodyStr) as unknown) : {};
      for (const fixture of fixtures) {
        if (fixture.requestMatcher(url, body)) {
          const res =
            typeof fixture.response === "function" ? fixture.response() : fixture.response.clone();
          return Promise.resolve(res);
        }
      }
      return Promise.reject(new Error(`Unexpected fetch call: ${url} ${JSON.stringify(body)}`));
    }),
  );
}

export function clearMockFetch(): void {
  fixtures.length = 0;
}

export function teardownMockFetch(): void {
  fixtures.length = 0;
  vi.unstubAllGlobals();
}

export function matchAlchemyMethod(
  method: string,
  address: string,
  categories: readonly string[],
): AlchemyFixture["requestMatcher"] {
  return (_url: string, body: unknown) => {
    const b = body as {
      method?: string;
      params?: [{ fromAddress?: string; toAddress?: string; category?: string[] }];
    };
    if (b.method !== method) return false;
    const p = b.params?.[0];
    if (!p) return false;
    const addr = p.fromAddress ?? p.toAddress;
    if (addr?.toLowerCase() !== address.toLowerCase()) return false;
    const cats = p.category ?? [];
    return categories.every((c) => cats.includes(c));
  };
}

export function createAlchemyResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function createAlchemyErrorResponse(status: number, statusText = ""): Response {
  return new Response("", { status, statusText });
}
