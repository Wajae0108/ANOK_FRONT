// AI/Context Orchestration(06) 서비스 시나리오: 스코프별 대화, 권한 인지 인용, 동시성 잠금,
// SensitiveInputGuard, 관리자 설정, 사용량 요약.
import { describe, it, expect } from "vitest";
import * as ai from "../src/api/ai";
import * as doc from "../src/api/document";
import * as mtg from "../src/api/meeting";
import * as prj from "../src/api/project";
import { code, createScenario, loginAdmin, loginAs, loginSmart, sleep, stepUpAdmin, userIdByEmailAdmin } from "./helpers";

function collect(conversationId: string, content: string, opts: any = {}) {
  return new Promise<{ started: any; sources: any[]; delta: string; completed: any; error: any }>(resolve => {
    const sources: any[] = []; let delta = "";
    let started: any = null, completed: any = null, error: any = null;
    ai.sendAiMessage(conversationId, { content, ...opts }, {
      onStarted: e => { started = e; },
      onSource: e => sources.push(e),
      onDelta: t => { delta += t; },
      onCompleted: e => { completed = e; resolve({ started, sources, delta, completed, error }); },
      onError: e => { error = e; resolve({ started, sources, delta, completed, error }); },
    });
  });
}

describe("AI(06) 시나리오", () => {
  it("스코프별 대화/권한 인지 인용/동시성 잠금/민감정보 차단/관리자 설정이 명세대로 동작한다", async () => {
    const scenario = createScenario();
    const { ok } = scenario;

    await loginAdmin("insung@anok.io");
    const jihyunId = await userIdByEmailAdmin("jihyun@anok.io");
    void jihyunId;

    // ── 모델 목록 ──
    await loginAs("wonjae@anok.io");
    const models = await ai.listAvailableModels();
    ok("AI 활성화 상태에서 기본 모델 존재", models.aiEnabled === true && !!models.default);

    // ── PROJECT 스코프: wonjae는 aiPipeline MANAGER ──
    const myProjects = await prj.listProjects();
    const aiProject = myProjects.items.find((p: any) => p.name === "AI 회의록 파이프라인")!;
    const authProject = myProjects.items.find((p: any) => p.name === "인증 시스템 개편")!;

    const conv = await ai.createConversation({ scopeType: "PROJECT", scopeResourceId: aiProject.projectId });
    ok("PROJECT 스코프 대화 생성", conv.status === "ACTIVE" && conv.scopeType === "PROJECT");

    ok("존재하지 않는 프로젝트로 대화 생성 → 404", (await code(ai.createConversation({ scopeType: "PROJECT", scopeResourceId: crypto.randomUUID() }))) === "404 SCOPE_RESOURCE_NOT_FOUND");

    const r1 = await collect(conv.conversationId, "이 프로젝트 진행 상황을 요약해줘");
    ok("generation_started 이벤트 수신", !!r1.started && r1.started.conversationId === conv.conversationId);
    ok("생성 완료 이벤트 수신, 텍스트에 프로젝트명 포함", !!r1.completed && r1.delta.includes("AI 회의록 파이프라인"));
    ok("결정 사항이 있으면 source 이벤트로 인용", r1.sources.length > 0 && r1.sources.every((s: any) => s.resourceType === "PROJECT"));

    const detail1 = await ai.getConversation(conv.conversationId);
    ok("대화 상세에 사용자+어시스턴트 메시지 2건", detail1.messages.length === 2 && detail1.messages[0].role === "USER" && detail1.messages[1].role === "ASSISTANT");
    ok("어시스턴트 메시지에 source 포함", detail1.messages[1].sources.length > 0);

    // ── 동시 생성 방지 ──
    const [ra, rb] = await Promise.all([collect(conv.conversationId, "질문 A"), collect(conv.conversationId, "질문 B")]);
    const oneBlocked = [ra, rb].some(r => r.error?.errorCode === "AI_GENERATION_ALREADY_IN_PROGRESS");
    ok("동시에 같은 대화에 두 번 질문하면 하나는 AI_GENERATION_ALREADY_IN_PROGRESS", oneBlocked);

    // ── SensitiveInputGuard ──
    const beforeCount = (await ai.getConversation(conv.conversationId)).messages.length;
    const blocked = await collect(conv.conversationId, "내 API 키는 sk-abcdefghijklmnopqrstuvwx 입니다");
    ok("민감정보 포함 질문은 사전 차단(AI_PROCESSING_BLOCKED_BY_POLICY)", blocked.error?.errorCode === "AI_PROCESSING_BLOCKED_BY_POLICY");
    const afterCount = (await ai.getConversation(conv.conversationId)).messages.length;
    ok("차단된 질문은 저장되지 않음(메시지 수 불변)", afterCount === beforeCount);

    // ── 무관한 프로젝트로 대화 생성 시도 → 접근 거부 ──
    await loginSmart("dayoung@anok.io"); // dayoung은 authRevamp 멤버 아님(project-scenario 전제와 동일)
    ok("프로젝트 멤버가 아니면 대화 생성 거부", (await code(ai.createConversation({ scopeType: "PROJECT", scopeResourceId: authProject.projectId }))) === "403 AI_SCOPE_ACCESS_DENIED");
    await loginAs("wonjae@anok.io");

    // ── 대화 종료 ──
    const closed = await ai.closeConversation(conv.conversationId);
    ok("대화 종료", closed.status === "CLOSED" && !!closed.closedAt);
    ok("종료된 대화에 메시지 전송 불가", (await collect(conv.conversationId, "종료 후 질문")).error?.errorCode === "AI_CONVERSATION_CLOSED");
    ok("이미 종료된 대화 재종료 → 409", (await code(ai.closeConversation(conv.conversationId))) === "409 AI_CONVERSATION_ALREADY_CLOSED");

    // ── DOCUMENT 스코프 ──
    await loginAs("gyuchan@anok.io");
    const docs = await doc.listDocuments();
    const apiSpec = docs.items.find((d: any) => d.title === "API 명세서 v2.1.pdf")!;
    const docConv = await ai.createConversation({ scopeType: "DOCUMENT", scopeResourceId: apiSpec.documentId });
    const rDoc = await collect(docConv.conversationId, "이 문서 요약해줘");
    ok("DOCUMENT 스코프 답변에 문서명 포함, source resourceType=DOCUMENT", rDoc.delta.includes(apiSpec.title) && rDoc.sources.every((s: any) => s.resourceType === "DOCUMENT"));

    // ── MEETING 스코프: 회의록 승인 후에만 인용 ──
    await loginAs("wonjae@anok.io");
    const seedList = await mtg.listMeetings();
    const endedSeed = seedList.items.find((m: any) => m.status === "ENDED")!;
    let pp = await mtg.getMeetingPostprocess(endedSeed.meetingId);
    const t0 = Date.now();
    while (pp.status !== "MINUTES_DRAFT" && Date.now() - t0 < 15000) { await sleep(300); pp = await mtg.getMeetingPostprocess(endedSeed.meetingId); }
    const meetingConvBeforeApproval = await ai.createConversation({ scopeType: "MEETING", scopeResourceId: endedSeed.meetingId });
    const rBefore = await collect(meetingConvBeforeApproval.conversationId, "회의 내용 알려줘");
    ok("승인 전 회의록은 인용되지 않음(source 없음)", rBefore.sources.length === 0);

    const draftMinutes = await mtg.getMeetingMinutes(endedSeed.meetingId);
    if (draftMinutes.status === "DRAFT") await mtg.approveMeetingMinutes(endedSeed.meetingId, draftMinutes.version);
    const meetingConv = await ai.createConversation({ scopeType: "MEETING", scopeResourceId: endedSeed.meetingId });
    const rMeeting = await collect(meetingConv.conversationId, "회의 내용 알려줘");
    ok("승인된 회의록은 MEETING_MINUTES source로 인용", rMeeting.sources.length > 0 && rMeeting.sources[0].resourceType === "MEETING_MINUTES");

    // ── 관리자 설정 ──
    await loginAdmin("insung@anok.io");
    ok("일반 관리자 GET 조회는 step-up 없이 가능", (await ai.getCompanyAiSettings()).aiEnabled === true);
    await loginAs("wonjae@anok.io");
    ok("비관리자는 설정 조회 불가", (await code(ai.getCompanyAiSettings())) === "403 ADMIN_REQUIRED");

    await loginAdmin("insung@anok.io");
    const settings = await ai.getCompanyAiSettings();
    ok("PUT은 step-up 필요", (await code(ai.updateCompanyAiSettings({ ...settings, aiEnabled: settings.aiEnabled }))) === "403 STEP_UP_REQUIRED");
    await stepUpAdmin();
    ok("승인되지 않은 모델 지정 → 403", (await code(ai.updateCompanyAiSettings({ aiEnabled: true, defaultGenerationProvider: "OPENAI", defaultGenerationModel: "gpt-5-fake", enabledGenerationModels: [{ provider: "OPENAI", model: "gpt-5-fake" }], version: settings.version }))) === "403 AI_MODEL_NOT_APPROVED");
    ok("기본 모델이 활성 목록에 없으면 → 409", (await code(ai.updateCompanyAiSettings({ aiEnabled: true, defaultGenerationProvider: "OPENAI", defaultGenerationModel: "gpt-4o", enabledGenerationModels: [{ provider: "ANTHROPIC", model: "claude-sonnet-5" }], version: settings.version }))) === "409 DEFAULT_MODEL_NOT_ENABLED");
    const updated = await ai.updateCompanyAiSettings({ aiEnabled: true, defaultGenerationProvider: "OPENAI", defaultGenerationModel: "gpt-4o", enabledGenerationModels: [{ provider: "OPENAI", model: "gpt-4o" }, { provider: "ANTHROPIC", model: "claude-haiku-4-5" }], version: settings.version });
    ok("정상 설정 변경 성공", updated.defaultGenerationModel === "gpt-4o" && updated.version === settings.version + 1);
    ok("stale version 재사용 → 409", (await code(ai.updateCompanyAiSettings({ ...settings, version: settings.version }))) === "409 VERSION_CONFLICT");

    const adminModels = await ai.listAdminApprovedModels();
    ok("관리자 승인 모델 목록에 enabledForCompany 반영", adminModels.models.find((m: any) => m.provider === "OPENAI" && m.model === "gpt-4o")?.enabledForCompany === true);

    // ── AI 비활성화 ──
    const settings2 = await ai.getCompanyAiSettings();
    await stepUpAdmin();
    await ai.updateCompanyAiSettings({ aiEnabled: false, defaultGenerationProvider: settings2.defaultGenerationProvider, defaultGenerationModel: settings2.defaultGenerationModel, enabledGenerationModels: settings2.enabledGenerationModels, version: settings2.version });
    await loginAs("wonjae@anok.io");
    const disabledModels = await ai.listAvailableModels();
    ok("AI 비활성화 시 모델 목록 비어있음", disabledModels.aiEnabled === false && disabledModels.models.length === 0);
    ok("AI 비활성화 시 새 대화 생성 불가", (await code(ai.createConversation({ scopeType: "PROJECT", scopeResourceId: aiProject.projectId }))) === "403 AI_DISABLED");
    await loginAs("gyuchan@anok.io");
    ok("AI 비활성화여도 기존 대화 종료는 허용", (await code(ai.closeConversation(docConv.conversationId))) === "OK");
    await loginAs("wonjae@anok.io");

    // ── 사용량 요약 ──
    await loginAdmin("insung@anok.io");
    const usage = await ai.getCompanyAiUsage({ groupBy: "PROVIDER" });
    ok("사용량 요약에 앞서 성공한 대화형 요청이 집계됨", usage.totals.requestCount >= 3);

    expect(scenario.fail, scenario.summary()).toBe(0);
  }, 60000);
});
