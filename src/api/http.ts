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
  // 호출 측이 키를 직접 쥐고 있을 때(예: 화면에서 사용자가 "다시 시도"를 눌러도 같은 요청으로 취급해야 하는 경우) 넘긴다.
  // 새로운 동작("하나 더 만들기", "최신으로 다시 만들기")은 키를 넘기지 않아 매번 새 키가 만들어지게 한다.
  idempotencyKey?: string;
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

// 401이 전부 "세션 만료"는 아니다. 회의 비밀번호 오류(MEETING_PASSWORD_INVALID), 로그인·단계 인증의 자격 증명 오류도 401이다.
// 토큰 문제로 확인되는 코드(또는 코드가 없는 게이트웨이 401)만 refresh 후 재시도한다. 그러지 않으면 비밀번호를 한 번 틀릴 때마다
// 같은 요청이 두 번 나가 5회 제한(MEETING_PASSWORD_RATE_LIMITED)이 두 배로 빨리 찬다.
const TOKEN_FAILURE_CODES = new Set(["TOKEN_INVALID", "TOKEN_REVOKED", "UNAUTHORIZED", "GATEWAY_AUTH_REQUIRED", "GATEWAY_TOKEN_INVALID", "GATEWAY_TOKEN_REVOKED"]);
export const isTokenFailure = (status: number, errorCode: string) => status === 401 && TOKEN_FAILURE_CODES.has(errorCode);

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
    if (isTokenFailure(res.status, err.errorCode) && !refreshed) {
      let ok = false;
      try { ok = await refreshSession(); } catch { throw err; }
      if (ok) return execute<T>(opts, idemKey, true, steppedUp);
      handlers.onExpired?.();
      throw err;
    }
    // Identity/Project/Meeting/AI는 STEP_UP_REQUIRED, Document Service는 MFA_STEP_UP_REQUIRED를 돌려준다.
    if (res.status === 403 && (err.errorCode === "STEP_UP_REQUIRED" || err.errorCode === "MFA_STEP_UP_REQUIRED") && !steppedUp && handlers.onStepUp) {
      if (await handlers.onStepUp()) return execute<T>(opts, idemKey, refreshed, true);
    }
  }
  throw err;
}

// 네트워크 오류(응답을 못 받음)와 503(다른 서비스 장애)은 서버가 요청을 처리했는지 알 수 없거나 아무것도 바꾸지 않은 경우라,
// 멱등 요청은 **같은 키**로 다시 보내면 안전하다(처음 응답을 그대로 돌려준다). 새 키로 보내면 회의·참여자가 하나 더 생길 수 있다.
const SAME_KEY_RETRIES = 2;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function request<T = void>(opts: RequestOptions): Promise<T> {
  const key = opts.idempotent ? (opts.idempotencyKey ?? crypto.randomUUID()) : undefined;
  for (let attempt = 0; ; attempt++) {
    try {
      return await execute<T>(opts, key, false, false);
    } catch (e) {
      const retriable = !!key && attempt < SAME_KEY_RETRIES && e instanceof ApiError && (e.status === 0 || e.status === 503);
      if (!retriable) throw e;
      await sleep(500 * (attempt + 1));
    }
  }
}

// Content-Disposition에서 파일 이름을 꺼낸다. `filename*=UTF-8''<퍼센트 인코딩>`(한글 이름)이 있으면 그것을 우선하고,
// 없으면 `filename="..."`을 쓴다(둘이 같이 오면 filename*가 뒤에 오므로 순서에 기대지 않는다).
export function parseFilename(contentDisposition: string | null): string {
  const cd = contentDisposition ?? "";
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(cd);
  if (star) { try { return decodeURIComponent(star[1].trim()); } catch { return star[1].trim(); } }
  const plain = /filename\s*=\s*(?:"([^"]*)"|([^";]+))/i.exec(cd);
  const raw = plain ? (plain[1] ?? plain[2]).trim() : "";
  if (!raw) return "download";
  try { return decodeURIComponent(raw); } catch { return raw; }
}

// FILE_DOWNLOAD 라우트: 성공 시 공통 JSON Wrapper를 쓰지 않고 raw binary stream을 반환한다(§0.1 공통 응답 규격 적용 제외).
// headers: 보고서 PDF의 x-report-pdf-unplaced / x-report-pdf-cut 같은 응답 헤더를 호출 측이 읽을 수 있게 그대로 돌려준다.
export async function downloadFile(path: string, refreshed = false, signal?: AbortSignal): Promise<{ blob: Blob; filename: string; headers: Headers }> {
  const token = tokenStore.get();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = USE_MOCK ? await mockDownload(path, headers) : await fetch(API_BASE_URL + path, { headers, signal });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "네트워크 오류");
  }

  if (!res.ok) {
    let body: any = null;
    try { body = await res.json(); } catch { /* noop */ }
    const err = new ApiError(res.status, body?.errorCode ?? DEFAULT_CODES[res.status] ?? "UNKNOWN_ERROR", body?.message ?? "다운로드에 실패했습니다.", body?.requestId);
    if (res.status === 401 && !refreshed && (await refreshSession().catch(() => false))) return downloadFile(path, true, signal);
    throw err;
  }
  return { blob: await res.blob(), filename: parseFilename(res.headers.get("Content-Disposition")), headers: res.headers };
}

// 스트림 연결 시점에 Access Token이 만료돼 401이면 refresh 후 1회 재시도한다. 갱신도 실패하면 세션 만료로 처리한다.
async function retryStreamOnce(res: Response, refreshed: boolean, retry: () => Promise<Response>): Promise<Response> {
  if (res.status !== 401 || refreshed) return res;
  let ok = false;
  try { ok = await refreshSession(); } catch { return res; }
  if (ok) return retry();
  handlers.onExpired?.();
  return res;
}

// SSE 라우트: 공통 JSON Wrapper 없이 text/event-stream 바디를 그대로 반환한다(query token 금지, Bearer 헤더만 사용).
// 호출 측은 res.ok를 확인해야 한다 — 실패 시 바디는 SSE가 아니라 공통 실패 JSON이다.
// extraHeaders: 채팅 스트림의 Last-Event-ID처럼 재접속 때 이어받을 위치를 알리는 헤더.
export async function openStream(path: string, signal?: AbortSignal, refreshed = false, extraHeaders: Record<string, string> = {}): Promise<Response> {
  const token = tokenStore.get();
  const headers: Record<string, string> = { Accept: "text/event-stream", ...extraHeaders };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = USE_MOCK ? await mockStream(path, headers, signal) : await fetch(API_BASE_URL + path, { headers, signal });
  return retryStreamOnce(res, refreshed, () => openStream(path, signal, true, extraHeaders));
}

// AI-API-05 전용: POST 본문 + Idempotency-Key를 실어 SSE 스트림을 연다(공통 JSON Wrapper 없음).
export async function openMessageStream(path: string, body: unknown, idemKey: string, signal?: AbortSignal, refreshed = false): Promise<Response> {
  const token = tokenStore.get();
  const headers: Record<string, string> = { Accept: "text/event-stream", "Content-Type": "application/json", "Idempotency-Key": idemKey };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = USE_MOCK
    ? await mockStream(path, headers, signal, body)
    : await fetch(API_BASE_URL + path, { method: "POST", headers, body: JSON.stringify(body), signal });
  // 같은 Idempotency-Key로 재시도하므로 서버가 이미 접수했더라도 중복 실행되지 않는다.
  return retryStreamOnce(res, refreshed, () => openMessageStream(path, body, idemKey, signal, true));
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
