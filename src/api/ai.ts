// Anok_06_AI_Context_Orchestration_API_Event_Spec_v2_3_3_FINAL — Public API 10개.
// 대화형 질의응답(AI-API-05)은 명세상 fetch-streaming SSE이며, mock 모드에서도 실제 ReadableStream으로 재현한다.
// 실제 OpenAI/Anthropic/Qdrant 호출은 없음 — mock은 이미 존재하는 Project/Document/Meeting mock 데이터를 권한 검증 후
// 인용하는 방식으로 "권한 인지 RAG"(§8 Permission-aware RAG)를 재현한다. Kafka 기반 백그라운드 AI 잡(DOCUMENT_PROCESS,
// MEETING_STT/MINUTES/CANDIDATES)은 03/04에서 Document/Meeting mock 자체의 파이프라인으로 이미 구현되어 있다.
import { openMessageStream, request } from "./http";
import type { CursorPage, Rfc3339, Uuid } from "./types";

export type ConversationScopeType = "PROJECT" | "DOCUMENT" | "MEETING";
export type ConversationStatus = "ACTIVE" | "CLOSED";
export type MessageRole = "USER" | "ASSISTANT";
export type MessagePersistenceStatus = "COMPLETED" | "ABORTED";
export type AiProvider = "OPENAI" | "ANTHROPIC";
export type SourceResourceType = "DOCUMENT" | "MEETING_MINUTES" | "PROJECT";

export interface SourceRef { sourceId: Uuid; resourceType: SourceResourceType; resourceId: Uuid; resourceVersionId?: Uuid | null; label: string }
export interface ConversationSummaryResponse {
  conversationId: Uuid; scopeType: ConversationScopeType; scopeResourceId: Uuid; status: ConversationStatus;
  lastMessagePreview?: string | null; createdAt: Rfc3339; updatedAt: Rfc3339; closedAt?: Rfc3339 | null;
}
export interface ConversationMessageResponse {
  messageId: Uuid; role: MessageRole; status: MessagePersistenceStatus; content: string | null; placeholder?: string;
  provider?: string | null; model?: string | null; createdAt: Rfc3339; completedAt?: Rfc3339 | null; sources: SourceRef[];
}
export interface ConversationDetailResponse { conversation: ConversationSummaryResponse; messages: ConversationMessageResponse[]; nextCursor?: string | null }
export interface AvailableGenerationModelsResponse { aiEnabled: boolean; default: { provider: string; model: string } | null; models: { provider: string; model: string }[] }
export interface CompanyAiSettingsResponse {
  aiEnabled: boolean; defaultGenerationProvider: string; defaultGenerationModel: string;
  enabledGenerationModels: { provider: string; model: string }[]; updatedByUserId: Uuid | null; updatedAt: Rfc3339; version: number;
}
export interface AdminGenerationModelsResponse {
  models: { provider: string; model: string; enabledForCompany: boolean; defaultForCompany: boolean; policyStatus: "AVAILABLE" }[];
  registryAsOf: Rfc3339;
}
export interface CompanyAiUsageResponse {
  period: { from: string | null; to: string | null };
  totals: { requestCount: number; inputTokens: number; outputTokens: number; estimatedCost: number };
  breakdown: { key: string; requestCount: number; inputTokens: number; outputTokens: number; estimatedCost: number }[];
  blockedRequestCount: number; failedRequestCount: number;
}

const auth = { auth: "bearer" } as const;

export const listConversations = (q: { cursor?: string; limit?: number; status?: ConversationStatus; scopeType?: ConversationScopeType } = {}) =>
  request<CursorPage<ConversationSummaryResponse>>({ method: "GET", path: "/api/ai/conversations", query: q, ...auth });
export const createConversation = (b: { scopeType: ConversationScopeType; scopeResourceId: Uuid }) =>
  request<ConversationSummaryResponse>({ method: "POST", path: "/api/ai/conversations", body: b, ...auth, idempotent: true });
export const getConversation = (conversationId: Uuid) =>
  request<ConversationDetailResponse>({ method: "GET", path: `/api/ai/conversations/${conversationId}`, ...auth });
// Gateway 라우트가 CT_NONE이라 본문을 보내면 415다(빈 `{}` 포함).
export const closeConversation = (conversationId: Uuid) =>
  request<ConversationSummaryResponse>({ method: "POST", path: `/api/ai/conversations/${conversationId}/close`, ...auth, idempotent: true });
export const listAvailableModels = () => request<AvailableGenerationModelsResponse>({ method: "GET", path: "/api/ai/models", ...auth });

export const getCompanyAiSettings = () => request<CompanyAiSettingsResponse>({ method: "GET", path: "/api/admin/ai/settings", ...auth });
export const updateCompanyAiSettings = (b: { aiEnabled: boolean; defaultGenerationProvider: string; defaultGenerationModel: string; enabledGenerationModels: { provider: string; model: string }[]; version: number }) =>
  request<CompanyAiSettingsResponse>({ method: "PUT", path: "/api/admin/ai/settings", body: b, ...auth });
export const listAdminApprovedModels = (q: { provider?: string } = {}) =>
  request<AdminGenerationModelsResponse>({ method: "GET", path: "/api/admin/ai/models", query: q, ...auth });
export const getCompanyAiUsage = (q: { from?: string; to?: string; groupBy?: "DAY" | "PROVIDER" | "MODEL" | "REQUEST_TYPE" } = {}) =>
  request<CompanyAiUsageResponse>({ method: "GET", path: "/api/admin/ai/usage", query: q, ...auth });

export interface AiStreamHandlers {
  onStarted?: (e: { operationId: Uuid; conversationId: Uuid; userMessageId: Uuid; provider?: string; model?: string }) => void;
  onSource?: (e: SourceRef) => void;
  onDelta?: (text: string) => void;
  onCompleted?: (e: { operationId: Uuid; assistantMessageId: Uuid; finishReason: string; sources: SourceRef[] }) => void;
  onError?: (e: { errorCode: string; message: string }) => void;
}

// AI-API-05: SSE 이벤트(generation_started/source/delta/generation_completed/generation_error)를 콜백으로 전달한다.
export function sendAiMessage(conversationId: Uuid, b: { content: string; preferredProvider?: AiProvider; preferredModel?: string }, handlers: AiStreamHandlers): { stop: () => void } {
  const controller = new AbortController();
  (async () => {
    let res: Response;
    try {
      res = await openMessageStream(`/api/ai/conversations/${conversationId}/messages`, b, crypto.randomUUID(), controller.signal);
    } catch {
      if (!controller.signal.aborted) handlers.onError?.({ errorCode: "AI_PROVIDER_UNAVAILABLE", message: "연결에 실패했습니다." });
      return;
    }
    if (!res.ok) {
      let body: any = null;
      try { body = await res.json(); } catch { /* 비-JSON 사전 오류 응답 */ }
      handlers.onError?.({ errorCode: body?.errorCode ?? "INTERNAL_SERVER_ERROR", message: body?.message ?? "요청을 처리할 수 없습니다." });
      return;
    }
    if (!res.body) return;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const lines = chunk.split("\n");
          const eventLine = lines.find(l => l.startsWith("event:"));
          const dataLine = lines.find(l => l.startsWith("data:"));
          if (!eventLine || !dataLine) continue;
          const event = eventLine.slice(6).trim();
          let data: any;
          try { data = JSON.parse(dataLine.slice(5).trim()); } catch { continue; }
          if (event === "generation_started") handlers.onStarted?.(data);
          else if (event === "source") handlers.onSource?.(data);
          else if (event === "delta") handlers.onDelta?.(data.text);
          else if (event === "generation_completed") handlers.onCompleted?.(data);
          else if (event === "generation_error") handlers.onError?.(data);
        }
      }
    } catch {
      if (!controller.signal.aborted) handlers.onError?.({ errorCode: "AI_PROVIDER_UNAVAILABLE", message: "스트림이 중단되었습니다." });
    }
  })();
  return { stop: () => controller.abort() };
}
