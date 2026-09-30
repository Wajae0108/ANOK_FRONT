import { API_BASE_URL, USE_MOCK } from "./config";
import { ApiError } from "./errors";
import { mockDownload, mockFetch, mockStream } from "./mock";
import { tokenStore } from "./tokenStore";

export { tokenStore };

export interface RequestOptions {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  // FormData면 그대로 전송한다(Content-Type을 직접 지정하지 않아 브라우저가 boundary를 채운다).
  body?: unknown;
  // bearer: Authorization 헤더 + 401 시 refresh 후 1회 재시도 + STEP_UP_REQUIRED 시 step-up 후 1회 재시도
  auth?: "bearer" | "none";
  // anok_refresh HttpOnly Cookie를 주고받는 라우트
  cookies?: boolean;
  // Idempotency-Key(UUID) 필수/선택 라우트. 재시도 시 같은 키를 재사용한다.
  idempotent?: boolean;
}

interface SessionHandlers {
  onExpired?: () => void;
  onStepUp?: () => Promise<boolean>;
}
const handlers: SessionHandlers = {};
export function configureSession(h: SessionHandlers) {
  handlers.onExpired = h.onExpired;
  handlers.onStepUp = h.onStepUp;
}

const DEFAULT_CODES: Record<number, string> = {
  400: "VALIDATION_ERROR", 401: "UNAUTHORIZED", 403: "FORBIDDEN", 404: "NOT_FOUND", 405: "METHOD_NOT_ALLOWED",
  409: "CONFLICT", 413: "PAYLOAD_TOO_LARGE", 415: "UNSUPPORTED_MEDIA_TYPE", 429: "RATE_LIMIT_EXCEEDED",
  502: "BAD_GATEWAY", 503: "SERVICE_UNAVAILABLE", 504: "GATEWAY_TIMEOUT",
};

function buildUrl(path: string, query?: RequestOptions["query"]) {
  const url = new URL(API_BASE_URL + path, window.location.origin);
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  return url.toString();
}

async function execute<T>(opts: RequestOptions, idemKey: string | undefined, refreshed: boolean, steppedUp: boolean): Promise<T> {
  const isForm = typeof FormData !== "undefined" && opts.body instanceof FormData;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.body !== undefined && !isForm) headers["Content-Type"] = "application/json";
  const token = tokenStore.get();
  if (opts.auth === "bearer" && token) headers.Authorization = `Bearer ${token}`;
  if (idemKey) headers["Idempotency-Key"] = idemKey;

  let res: Response;
  try {
    const target = buildUrl(opts.path, opts.query);
    const payload = isForm ? (opts.body as FormData) : opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    res = USE_MOCK
      ? await mockFetch(target, { method: opts.method, headers, body: payload })
      : await fetch(target, { method: opts.method, headers, body: payload, credentials: opts.cookies ? "include" : "omit" });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "네트워크 오류");
  }

  if (res.status === 204) return undefined as T;

  const headerRequestId = res.headers.get("X-Request-Id") ?? undefined;
  let body: any = null;
  try { body = await res.json(); } catch { /* Gateway/Proxy가 만든 비-JSON 응답 */ }

  if (res.ok && body?.success === true) return body.data as T;

  const err = new ApiError(
    res.status,
    body?.errorCode ?? DEFAULT_CODES[res.status] ?? "UNKNOWN_ERROR",
    body?.message ?? "요청을 처리할 수 없습니다.",
    body?.requestId ?? headerRequestId,
    Array.isArray(body?.fieldErrors) ? body.fieldErrors : undefined,
  );

  if (opts.auth === "bearer") {
    if (res.status === 401 && !refreshed) {
      let ok = false;
      try { ok = await refreshSession(); } catch { throw err; }
      if (ok) return execute<T>(opts, idemKey, true, steppedUp);
      handlers.onExpired?.();
      throw err;
    }
    if (res.status === 403 && err.errorCode === "STEP_UP_REQUIRED" && !steppedUp && handlers.onStepUp) {
      if (await handlers.onStepUp()) return execute<T>(opts, idemKey, refreshed, true);
    }
  }
  throw err;
}

export function request<T = void>(opts: RequestOptions): Promise<T> {
  return execute<T>(opts, opts.idempotent ? crypto.randomUUID() : undefined, false, false);
}

function parseFilename(contentDisposition: string | null): string {
  const m = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(contentDisposition ?? "");
  try { return m ? decodeURIComponent(m[1]) : "download"; } catch { return m?.[1] ?? "download"; }
}

// FILE_DOWNLOAD 라우트: 성공 시 공통 JSON Wrapper를 쓰지 않고 raw binary stream을 반환한다(§0.1 공통 응답 규격 적용 제외).
export async function downloadFile(path: string, refreshed = false): Promise<{ blob: Blob; filename: string }> {
  const token = tokenStore.get();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = USE_MOCK ? await mockDownload(path, headers) : await fetch(API_BASE_URL + path, { headers });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "네트워크 오류");
  }

  if (!res.ok) {
    let body: any = null;
    try { body = await res.json(); } catch { /* noop */ }
    const err = new ApiError(res.status, body?.errorCode ?? DEFAULT_CODES[res.status] ?? "UNKNOWN_ERROR", body?.message ?? "다운로드에 실패했습니다.", body?.requestId);
    if (res.status === 401 && !refreshed && (await refreshSession().catch(() => false))) return downloadFile(path, true);
    throw err;
  }
  return { blob: await res.blob(), filename: parseFilename(res.headers.get("Content-Disposition")) };
}

// SSE 라우트: 공통 JSON Wrapper 없이 text/event-stream 바디를 그대로 반환한다(query token 금지, Bearer 헤더만 사용).
export async function openStream(path: string, signal?: AbortSignal): Promise<Response> {
  const token = tokenStore.get();
  const headers: Record<string, string> = { Accept: "text/event-stream" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return USE_MOCK ? mockStream(path, headers, signal) : fetch(API_BASE_URL + path, { headers, signal });
}

// AI-API-05 전용: POST 본문 + Idempotency-Key를 실어 SSE 스트림을 연다(공통 JSON Wrapper 없음).
export async function openMessageStream(path: string, body: unknown, idemKey: string, signal?: AbortSignal): Promise<Response> {
  const token = tokenStore.get();
  const headers: Record<string, string> = { Accept: "text/event-stream", "Content-Type": "application/json", "Idempotency-Key": idemKey };
  if (token) headers.Authorization = `Bearer ${token}`;
  return USE_MOCK
    ? mockStream(path, headers, signal, body)
    : fetch(API_BASE_URL + path, { method: "POST", headers, body: JSON.stringify(body), signal });
}

let refreshing: Promise<boolean> | null = null;

// Refresh Token 회전은 중복 사용이 곧 탈취로 처리되므로 탭 내 single-flight + 브라우저 전체 Web Lock으로 직렬화한다.
export function refreshSession(): Promise<boolean> {
  if (!refreshing) {
    const run = async () => {
      try {
        const d = await request<{ accessToken: string }>({ method: "POST", path: "/api/auth/refresh", auth: "none", cookies: true });
        tokenStore.set(d.accessToken);
        return true;
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) { tokenStore.set(null); return false; }
        throw e;
      }
    };
    const locked: Promise<boolean> = typeof navigator !== "undefined" && navigator.locks
      ? navigator.locks.request("anok-refresh", run).then(v => v)
      : run();
    refreshing = locked.finally(() => { refreshing = null; });
  }
  return refreshing as Promise<boolean>;
}
