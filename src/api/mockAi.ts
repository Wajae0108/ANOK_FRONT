// Anok_06_AI_Context_Orchestration_API_Event_Spec_v2_3_3_FINAL 기준 인메모리 mock.
// 실제 벡터 검색/외부 LLM 호출은 없다 — 이미 존재하는 Project/Document/Meeting mock 데이터를 매 요청마다 다시
// 권한 검증(§8 Permission-aware RAG, §11 Conversation Source-level Reauthorization)한 뒤 인용해 결정론적 답변을
// 스트리밍한다. Kafka 기반 DOCUMENT_PROCESS/MEETING_STT/MEETING_MINUTES/MEETING_CANDIDATES 백그라운드 잡은
// 이 파일이 아니라 03(mockDocument)/04(mockMeeting) 자체 파이프라인으로 이미 구현되어 있다(§17 Inbound Internal
// HTTP는 MVP에 없고 Document/Meeting이 Kafka로 요청한다는 명세와 일치).
import type { RequestOptions } from "./http";
import { check, fail, invalid, str } from "./mockCore";
import type { MockUser } from "./mockCore";
import { getDocumentContextForAi } from "./mockDocument";
import { getMeetingContextForAi } from "./mockMeeting";
import { getProjectContextForAi } from "./mockProject";
import type { ConversationScopeType, ConversationStatus, MessagePersistenceStatus, MessageRole, SourceRef, SourceResourceType } from "./ai";
import type { FieldError } from "./types";

interface Conversation {
  conversationId: string; userId: string; scopeType: ConversationScopeType; scopeResourceId: string; status: ConversationStatus;
  createdAt: string; updatedAt: string; closedAt: string | null; lastMessagePreview: string | null;
}
interface StoredMessage {
  messageId: string; conversationId: string; role: MessageRole; status: MessagePersistenceStatus; content: string;
  provider: string | null; model: string | null; createdAt: string; completedAt: string | null; sources: SourceRef[];
}
interface UsageRecord { requestType: string; provider: string; model: string; inputTokens: number; outputTokens: number; estimatedCost: number; status: "SUCCEEDED" | "BLOCKED" | "FAILED"; createdAt: string }

const now = () => new Date().toISOString();
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const conversations: Conversation[] = [];
const messages: StoredMessage[] = [];
const generating = new Set<string>();
const usageRecords: UsageRecord[] = [];

const PLATFORM_MODELS = [
  { provider: "ANTHROPIC", model: "claude-sonnet-5" },
  { provider: "ANTHROPIC", model: "claude-haiku-4-5" },
  { provider: "OPENAI", model: "gpt-4o" },
  { provider: "OPENAI", model: "gpt-4o-mini" },
];
let companySettings = {
  aiEnabled: true, defaultGenerationProvider: "ANTHROPIC", defaultGenerationModel: "claude-sonnet-5",
  enabledGenerationModels: [{ provider: "ANTHROPIC", model: "claude-sonnet-5" }, { provider: "ANTHROPIC", model: "claude-haiku-4-5" }, { provider: "OPENAI", model: "gpt-4o-mini" }] as { provider: string; model: string }[],
  updatedByUserId: null as string | null, updatedAt: now(), version: 1,
};

const COST_PER_1K = { input: 0.003, output: 0.015 };
function estimateCost(inputChars: number, outputChars: number) {
  return Math.round(((inputChars / 4 / 1000) * COST_PER_1K.input + (outputChars / 4 / 1000) * COST_PER_1K.output) * 10000) / 10000;
}

// SensitiveInputGuard(§12) — high-confidence 패턴만 차단한다(LLM 의미 추론 없음).
const SENSITIVE_PATTERNS = [
  /sk-[A-Za-z0-9]{20,}/, /-----BEGIN (RSA |EC )?PRIVATE KEY-----/, /\b\d{6}-[1-4]\d{6}\b/, /\b(?:\d[ -]*?){13,16}\b/,
];

type ScopeAccessResult = { ok: true } | { ok: false; code: "SCOPE_RESOURCE_NOT_FOUND" | "AI_SCOPE_ACCESS_DENIED" };
function checkScopeAccess(scopeType: ConversationScopeType, scopeResourceId: string, userId: string): ScopeAccessResult {
  const ctx = scopeType === "PROJECT" ? getProjectContextForAi(scopeResourceId, userId)
    : scopeType === "DOCUMENT" ? getDocumentContextForAi(scopeResourceId, userId)
    : getMeetingContextForAi(scopeResourceId, userId);
  if (!ctx) return { ok: false, code: "SCOPE_RESOURCE_NOT_FOUND" };
  if (!ctx.accessible) return { ok: false, code: "AI_SCOPE_ACCESS_DENIED" };
  return { ok: true };
}
function sourceStillAccessible(s: SourceRef, userId: string): boolean {
  if (s.resourceType === "PROJECT") return getProjectContextForAi(s.resourceId, userId)?.accessible ?? false;
  if (s.resourceType === "DOCUMENT") return getDocumentContextForAi(s.resourceId, userId)?.accessible ?? false;
  return getMeetingContextForAi(s.resourceId, userId)?.accessible ?? false;
}

function buildAnswer(conv: Conversation, userId: string): { text: string; sources: SourceRef[] } {
  if (conv.scopeType === "PROJECT") {
    const ctx = getProjectContextForAi(conv.scopeResourceId, userId)!;
    const sources: SourceRef[] = ctx.decisions.map(d => ({ sourceId: crypto.randomUUID(), resourceType: "PROJECT" as SourceResourceType, resourceId: conv.scopeResourceId, resourceVersionId: null, label: `결정: ${d.title}` }));
    const text = [
      `"${ctx.name}" 프로젝트 기준으로 답변합니다.`,
      ctx.description ? `프로젝트 설명: ${ctx.description}` : null,
      `현재 업무는 총 ${ctx.taskSummary.total}건 중 진행 중 ${ctx.taskSummary.inProgress}건, 완료 ${ctx.taskSummary.done}건입니다.`,
      ctx.decisions.length ? `주요 결정 사항: ${ctx.decisions.map(d => d.title).join(", ")}.` : "아직 확정된 결정 사항이 없습니다.",
    ].filter(Boolean).join(" ");
    return { text, sources };
  }
  if (conv.scopeType === "DOCUMENT") {
    const ctx = getDocumentContextForAi(conv.scopeResourceId, userId)!;
    const sources: SourceRef[] = [{ sourceId: crypto.randomUUID(), resourceType: "DOCUMENT", resourceId: conv.scopeResourceId, resourceVersionId: null, label: ctx.title }];
    const text = `"${ctx.title}" 문서를 참고해 답변합니다.${ctx.description ? ` 문서 설명: ${ctx.description}.` : ""} 이 문서의 민감도 분류는 ${ctx.sensitivityClassification}입니다. 정책상 문서 본문 전체를 그대로 인용하지 않으며, 구체적인 확인이 필요하면 문서 원본을 직접 열람해 주세요.`;
    return { text, sources };
  }
  const ctx = getMeetingContextForAi(conv.scopeResourceId, userId)!;
  const sources: SourceRef[] = ctx.minutesContent ? [{ sourceId: crypto.randomUUID(), resourceType: "MEETING_MINUTES", resourceId: conv.scopeResourceId, resourceVersionId: null, label: `${ctx.title} 회의록` }] : [];
  const text = ctx.minutesContent
    ? `"${ctx.title}" 회의록을 바탕으로 답변합니다.\n\n${ctx.minutesContent.slice(0, 500)}`
    : `"${ctx.title}" 회의는 아직 승인된 회의록이 없어 참고할 수 있는 내용이 제한적입니다.`;
  return { text, sources };
}

function toConversationSummary(c: Conversation) {
  return { conversationId: c.conversationId, scopeType: c.scopeType, scopeResourceId: c.scopeResourceId, status: c.status, lastMessagePreview: c.lastMessagePreview, createdAt: c.createdAt, updatedAt: c.updatedAt, closedAt: c.closedAt };
}
function toMessageResponse(m: StoredMessage) {
  return { messageId: m.messageId, role: m.role, status: m.status, content: m.content, provider: m.provider, model: m.model, createdAt: m.createdAt, completedAt: m.completedAt, sources: m.sources };
}
function toSettingsResponse() { return { ...companySettings }; }

function encodeCursor(updatedAt: string, id: string): string { return btoa(JSON.stringify([updatedAt, id])); }
function decodeCursor(cursor: string): [string, string] {
  try {
    const v = JSON.parse(atob(cursor));
    if (!Array.isArray(v) || v.length !== 2 || typeof v[0] !== "string" || typeof v[1] !== "string") throw new Error("malformed");
    return v as [string, string];
  } catch { return fail(400, "INVALID_CURSOR"); }
}

function errorResponse(status: number, errorCode: string, fieldErrors?: FieldError[]): Response {
  const requestId = crypto.randomUUID();
  const body = { success: false, message: "요청을 처리할 수 없습니다.", data: null, errorCode, requestId, ...(fieldErrors ? { fieldErrors } : {}) };
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "X-Request-Id": requestId } });
}

// AI-API-05 SSE 스트림 — mock.ts의 mockStream()이 위임한다.
export function streamAiMessage(conversationId: string, body: unknown, me: MockUser, signal?: AbortSignal): Response {
  const conv = conversations.find(c => c.conversationId === conversationId && c.userId === me.userId);
  if (!conv) return errorResponse(404, "AI_CONVERSATION_NOT_FOUND");
  if (conv.status !== "ACTIVE") return errorResponse(409, "AI_CONVERSATION_CLOSED");
  if (!companySettings.aiEnabled) return errorResponse(403, "AI_DISABLED");
  const access = checkScopeAccess(conv.scopeType, conv.scopeResourceId, me.userId);
  if (!access.ok) return errorResponse(access.code === "SCOPE_RESOURCE_NOT_FOUND" ? 404 : 403, access.code);

  const b: any = body ?? {};
  const e: FieldError[] = [];
  const content = str(e, b, "content", 1, 4000);
  if (e.length) return errorResponse(400, "VALIDATION_ERROR", e);
  if (SENSITIVE_PATTERNS.some(re => re.test(content!))) return errorResponse(403, "AI_PROCESSING_BLOCKED_BY_POLICY");
  if (generating.has(conversationId)) return errorResponse(409, "AI_GENERATION_ALREADY_IN_PROGRESS");

  let provider = companySettings.defaultGenerationProvider;
  let model = companySettings.defaultGenerationModel;
  if (b.preferredProvider || b.preferredModel) {
    const wantProvider = b.preferredProvider ?? provider;
    const wantModel = b.preferredModel ?? model;
    if (!companySettings.enabledGenerationModels.some(m => m.provider === wantProvider && m.model === wantModel)) return errorResponse(403, "AI_MODEL_NOT_APPROVED");
    provider = wantProvider; model = wantModel;
  }

  generating.add(conversationId);
  const userMsg: StoredMessage = { messageId: crypto.randomUUID(), conversationId, role: "USER", status: "COMPLETED", content: content!, provider: null, model: null, createdAt: now(), completedAt: now(), sources: [] };
  messages.push(userMsg);

  const { text, sources } = buildAnswer(conv, me.userId);
  const operationId = crypto.randomUUID();
  const assistantMessageId = crypto.randomUUID();
  let aborted = false;
  signal?.addEventListener("abort", () => { aborted = true; });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => { try { controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); } catch { /* 연결이 이미 닫힘 */ } };
      send("generation_started", { operationId, conversationId, userMessageId: userMsg.messageId, provider, model });
      await sleep(150);
      for (const s of sources) {
        if (aborted) break;
        send("source", s);
        await sleep(80);
      }
      const words = text.split(" ");
      for (const w of words) {
        if (aborted) break;
        send("delta", { text: w + " " });
        await sleep(25);
      }
      generating.delete(conversationId);
      if (aborted) { try { controller.close(); } catch { /* 이미 닫힘 */ } return; }
      const assistantMsg: StoredMessage = { messageId: assistantMessageId, conversationId, role: "ASSISTANT", status: "COMPLETED", content: text, provider, model, createdAt: now(), completedAt: now(), sources };
      messages.push(assistantMsg);
      conv.lastMessagePreview = text.slice(0, 80); conv.updatedAt = now();
      usageRecords.push({ requestType: "INTERACTIVE", provider, model, inputTokens: Math.ceil(content!.length / 4), outputTokens: Math.ceil(text.length / 4), estimatedCost: estimateCost(content!.length, text.length), status: "SUCCEEDED", createdAt: now() });
      send("generation_completed", { operationId, assistantMessageId, finishReason: "STOP", sources });
      try { controller.close(); } catch { /* 이미 닫힘 */ }
    },
    cancel() { aborted = true; generating.delete(conversationId); },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

export function routeAi(o: RequestOptions, me: MockUser): unknown {
  const b: any = o.body ?? {};
  const q = o.query ?? {};
  const path = o.path;

  if (path === "/api/ai/conversations" && o.method === "GET") {
    const limit = Number(q.limit ?? 20);
    if (!(Number.isFinite(limit) && limit >= 1 && limit <= 100)) invalid({ field: "limit", reason: "OUT_OF_RANGE" });
    let rows = conversations.filter(c => c.userId === me.userId);
    if (q.status) rows = rows.filter(c => c.status === q.status);
    if (q.scopeType) rows = rows.filter(c => c.scopeType === q.scopeType);
    rows = rows.sort((a, c) => (a.updatedAt < c.updatedAt ? 1 : a.updatedAt > c.updatedAt ? -1 : a.conversationId < c.conversationId ? 1 : -1));
    if (q.cursor) {
      const [u, cid] = decodeCursor(String(q.cursor));
      rows = rows.filter(c => c.updatedAt < u || (c.updatedAt === u && c.conversationId < cid));
    }
    const page = rows.slice(0, limit);
    const hasNext = rows.length > limit;
    const last = page[page.length - 1];
    return { items: page.map(toConversationSummary), page: { limit, nextCursor: hasNext && last ? encodeCursor(last.updatedAt, last.conversationId) : null, hasNext } };
  }

  if (path === "/api/ai/conversations" && o.method === "POST") {
    const e: FieldError[] = [];
    if (!["PROJECT", "DOCUMENT", "MEETING"].includes(b.scopeType)) e.push({ field: "scopeType", reason: "INVALID_ENUM" });
    if (typeof b.scopeResourceId !== "string" || !b.scopeResourceId) e.push({ field: "scopeResourceId", reason: "REQUIRED" });
    check(e);
    if (!companySettings.aiEnabled) return fail(403, "AI_DISABLED");
    const access = checkScopeAccess(b.scopeType, b.scopeResourceId, me.userId);
    if (!access.ok) return fail(access.code === "SCOPE_RESOURCE_NOT_FOUND" ? 404 : 403, access.code);
    const conv: Conversation = { conversationId: crypto.randomUUID(), userId: me.userId, scopeType: b.scopeType, scopeResourceId: b.scopeResourceId, status: "ACTIVE", createdAt: now(), updatedAt: now(), closedAt: null, lastMessagePreview: null };
    conversations.push(conv);
    return toConversationSummary(conv);
  }

  let m = /^\/api\/ai\/conversations\/([^/]+)$/.exec(path);
  if (m && o.method === "GET") {
    const conv = conversations.find(c => c.conversationId === m![1] && c.userId === me.userId);
    if (!conv) return fail(404, "AI_CONVERSATION_NOT_FOUND");
    const access = checkScopeAccess(conv.scopeType, conv.scopeResourceId, me.userId);
    if (!access.ok) return fail(403, "AI_SCOPE_ACCESS_DENIED");
    const msgs = messages.filter(x => x.conversationId === conv.conversationId).sort((a, c) => a.createdAt.localeCompare(c.createdAt));
    const visible = msgs.map(msg => {
      if (msg.role !== "ASSISTANT" || msg.sources.every(s => sourceStillAccessible(s, me.userId))) return toMessageResponse(msg);
      return { ...toMessageResponse(msg), content: null, placeholder: "현재 접근 권한이 변경되어 이 답변을 표시할 수 없습니다." };
    });
    return { conversation: toConversationSummary(conv), messages: visible, nextCursor: null };
  }

  m = /^\/api\/ai\/conversations\/([^/]+)\/close$/.exec(path);
  if (m && o.method === "POST") {
    const conv = conversations.find(c => c.conversationId === m![1] && c.userId === me.userId);
    if (!conv) return fail(404, "AI_CONVERSATION_NOT_FOUND");
    if (conv.status === "CLOSED") return fail(409, "AI_CONVERSATION_ALREADY_CLOSED");
    conv.status = "CLOSED"; conv.closedAt = now(); conv.updatedAt = now();
    return toConversationSummary(conv);
  }

  if (path === "/api/ai/models" && o.method === "GET") {
    if (!companySettings.aiEnabled) return { aiEnabled: false, default: null, models: [] };
    return { aiEnabled: true, default: { provider: companySettings.defaultGenerationProvider, model: companySettings.defaultGenerationModel }, models: companySettings.enabledGenerationModels };
  }

  // ── Admin (mock.ts가 GET은 admin(), PUT settings는 stepUp() 통과 후 위임한다) ──
  if (path === "/api/admin/ai/settings" && o.method === "GET") return toSettingsResponse();
  if (path === "/api/admin/ai/settings" && o.method === "PUT") {
    const e: FieldError[] = [];
    if (typeof b.aiEnabled !== "boolean") e.push({ field: "aiEnabled", reason: "REQUIRED" });
    if (typeof b.defaultGenerationProvider !== "string" || !b.defaultGenerationProvider) e.push({ field: "defaultGenerationProvider", reason: "REQUIRED" });
    if (typeof b.defaultGenerationModel !== "string" || !b.defaultGenerationModel) e.push({ field: "defaultGenerationModel", reason: "REQUIRED" });
    if (!Array.isArray(b.enabledGenerationModels)) e.push({ field: "enabledGenerationModels", reason: "REQUIRED" });
    if (typeof b.version !== "number") e.push({ field: "version", reason: "REQUIRED" });
    check(e);
    if (b.version !== companySettings.version) return fail(409, "VERSION_CONFLICT");
    const enabled = b.enabledGenerationModels as { provider: string; model: string }[];
    const keys = enabled.map(x => `${x.provider}:${x.model}`);
    if (new Set(keys).size !== keys.length) invalid({ field: "enabledGenerationModels", reason: "DUPLICATE" });
    for (const x of enabled) if (!PLATFORM_MODELS.some(pm => pm.provider === x.provider && pm.model === x.model)) return fail(403, "AI_MODEL_NOT_APPROVED");
    if (b.aiEnabled && !enabled.some(x => x.provider === b.defaultGenerationProvider && x.model === b.defaultGenerationModel)) return fail(409, "DEFAULT_MODEL_NOT_ENABLED");
    companySettings = { aiEnabled: b.aiEnabled, defaultGenerationProvider: b.defaultGenerationProvider, defaultGenerationModel: b.defaultGenerationModel, enabledGenerationModels: enabled, updatedByUserId: me.userId, updatedAt: now(), version: companySettings.version + 1 };
    return toSettingsResponse();
  }
  if (path === "/api/admin/ai/models" && o.method === "GET") {
    const provider = q.provider as string | undefined;
    const models = PLATFORM_MODELS.filter(m2 => !provider || m2.provider === provider).map(m2 => ({
      ...m2, enabledForCompany: companySettings.enabledGenerationModels.some(x => x.provider === m2.provider && x.model === m2.model),
      defaultForCompany: companySettings.defaultGenerationProvider === m2.provider && companySettings.defaultGenerationModel === m2.model,
      policyStatus: "AVAILABLE" as const,
    }));
    return { models, registryAsOf: now() };
  }
  if (path === "/api/admin/ai/usage" && o.method === "GET") {
    const groupBy = (q.groupBy as string) ?? "PROVIDER";
    const zero = () => ({ requestCount: 0, inputTokens: 0, outputTokens: 0, estimatedCost: 0 });
    const totals = zero();
    const groups = new Map<string, ReturnType<typeof zero>>();
    for (const r of usageRecords) {
      totals.requestCount++; totals.inputTokens += r.inputTokens; totals.outputTokens += r.outputTokens; totals.estimatedCost += r.estimatedCost;
      const key = groupBy === "MODEL" ? r.model : groupBy === "REQUEST_TYPE" ? r.requestType : groupBy === "DAY" ? r.createdAt.slice(0, 10) : r.provider;
      const g = groups.get(key) ?? zero();
      g.requestCount++; g.inputTokens += r.inputTokens; g.outputTokens += r.outputTokens; g.estimatedCost += r.estimatedCost;
      groups.set(key, g);
    }
    return {
      period: { from: (q.from as string) ?? null, to: (q.to as string) ?? null }, totals,
      breakdown: [...groups.entries()].map(([key, v]) => ({ key, ...v })),
      blockedRequestCount: usageRecords.filter(r => r.status === "BLOCKED").length, failedRequestCount: usageRecords.filter(r => r.status === "FAILED").length,
    };
  }

  return fail(404, "NOT_FOUND");
}
