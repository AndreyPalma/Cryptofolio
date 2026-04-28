/**
 * apiClient — fetch wrapper with:
 * - credentials: 'include' (always)
 * - 401 interceptor → redirectToLogin() (unless skipAuthRedirect)
 * - JSON serialization for POST/PUT/PATCH
 */

export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
    // Fix instanceof in ESM/bundled contexts
    Object.setPrototypeOf(this, UnauthorizedError.prototype);
  }
}

export interface ApiOptions extends RequestInit {
  skipAuthRedirect?: boolean;
}

// Auth bridge — avoids circular dep between apiClient and AuthContext
let _redirectToLogin: () => void = () => {
  window.location.assign("/login");
};

export function registerAuthBridge(fn: () => void): void {
  _redirectToLogin = fn;
}

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

async function request<T>(
  method: string,
  url: string,
  body?: unknown,
  options: ApiOptions = {},
): Promise<T> {
  const { skipAuthRedirect, ...restOptions } = options;

  const headers: Record<string, string> = {
    ...(restOptions.headers as Record<string, string>),
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const fetchOptions: RequestInit = {
    ...restOptions,
    method,
    credentials: "include",
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };

  const response = await fetch(`${BASE_URL}${url}`, fetchOptions);

  if (response.status === 401) {
    if (!skipAuthRedirect) {
      _redirectToLogin();
    }
    throw new UnauthorizedError();
  }

  if (!response.ok) {
    throw new Error(`HTTP ${String(response.status)}: ${response.statusText}`);
  }

  // Parse JSON body
  const text = await response.text();
  if (!text) return undefined as unknown as T;
  return JSON.parse(text) as T;
}

export const apiClient = {
  get<T>(url: string, options?: ApiOptions): Promise<T> {
    return request<T>("GET", url, undefined, options);
  },
  post<T>(url: string, body?: unknown, options?: ApiOptions): Promise<T> {
    return request<T>("POST", url, body, options);
  },
  put<T>(url: string, body?: unknown, options?: ApiOptions): Promise<T> {
    return request<T>("PUT", url, body, options);
  },
  delete<T>(url: string, options?: ApiOptions): Promise<T> {
    return request<T>("DELETE", url, undefined, options);
  },
};
