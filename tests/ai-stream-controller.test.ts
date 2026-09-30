// src/ai/streamController.ts 단위 테스트 — 실제 sendAiMessage()/mock 스트림을 그대로 사용해
// "대화 전환 시 이전 스트림 콜백이 새 상태를 건드리지 않는지"를 순수 로직 수준에서 검증한다.
// (React 컴포넌트 렌더링 없이도 재현 가능한 부분이라 jsdom/React Testing Library를 새로 들이지 않았다.)
import { describe, it, expect } from "vitest";
import * as ai from "../src/api/ai";
import * as prj from "../src/api/project";
import { createAiStreamController } from "../src/ai/streamController";
import { loginAs, sleep } from "./helpers";

async function waitUntil(cond: () => boolean, timeoutMs = 5000, stepMs = 20) {
  const t0 = Date.now();
  while (!cond() && Date.now() - t0 < timeoutMs) await sleep(stepMs);
  return cond();
}

describe("createAiStreamController", () => {
  it("정상 스트림 1건은 끝까지 콜백이 전달되고 완료 후 active가 꺼진다", async () => {
    await loginAs("wonjae@anok.io");
    const aiProject = (await prj.listProjects()).items.find((p: any) => p.name === "AI 회의록 파이프라인")!;
    const conv = await ai.createConversation({ scopeType: "PROJECT", scopeResourceId: aiProject.projectId });

    const controller = createAiStreamController();
    const deltas: string[] = [];
    let completed = false, errored: any = null;
    controller.start(conv.conversationId, { content: "진행 상황 요약해줘" }, {
      onDelta: t => deltas.push(t),
      onCompleted: () => { completed = true; },
      onError: e => { errored = e; },
    });
    expect(controller.active).toBe(true);

    const done = await waitUntil(() => completed || !!errored);
    expect(done, "스트림이 시간 내에 끝나지 않음").toBe(true);
    expect(errored).toBeNull();
    expect(deltas.length).toBeGreaterThan(0);
    expect(controller.active).toBe(false);
  });

  it("[핵심] 대화를 전환하면 이전 스트림의 delta/완료 콜백이 새 상태에 섞이지 않는다", async () => {
    await loginAs("wonjae@anok.io");
    const aiProject = (await prj.listProjects()).items.find((p: any) => p.name === "AI 회의록 파이프라인")!;
    const convA = await ai.createConversation({ scopeType: "PROJECT", scopeResourceId: aiProject.projectId });
    const convB = await ai.createConversation({ scopeType: "PROJECT", scopeResourceId: aiProject.projectId });

    const controller = createAiStreamController();
    const deltasA: string[] = []; let completedA = false, errorA: any = null;
    const deltasB: string[] = []; let completedB = false, errorB: any = null;

    controller.start(convA.conversationId, { content: "A에게 질문" }, {
      onDelta: t => deltasA.push(t),
      onCompleted: () => { completedA = true; },
      onError: e => { errorA = e; },
    });
    // 대화 A의 응답이 하나라도 도착하기 전에(비동기 콜백이 하나도 실행되기 전에) 곧바로 대화 B로 전환한다.
    controller.start(convB.conversationId, { content: "B에게 질문" }, {
      onDelta: t => deltasB.push(t),
      onCompleted: () => { completedB = true; },
      onError: e => { errorB = e; },
    });

    const done = await waitUntil(() => completedB || !!errorB);
    expect(done, "전환한 대화(B)가 시간 내에 끝나지 않음").toBe(true);
    // 약간의 추가 대기를 둬 A의 레이스성 잔여 콜백이 있다면 여기서 걸러지는지까지 확인한다.
    await sleep(200);

    expect(errorB).toBeNull();
    expect(deltasB.length).toBeGreaterThan(0);
    expect(completedA, "취소된 이전 대화(A)의 완료 콜백이 호출되면 안 됨").toBe(false);
    expect(deltasA.length, "취소된 이전 대화(A)의 delta 콜백이 새 상태에 섞이면 안 됨").toBe(0);
    expect(errorA, "취소는 사용자 의도적 중단이므로 일반 오류 콜백으로 보고되면 안 됨").toBeNull();
  });

  it("cancel()로 명시 취소하면 이후 이벤트가 전달되지 않고 active가 꺼진다", async () => {
    await loginAs("wonjae@anok.io");
    const aiProject = (await prj.listProjects()).items.find((p: any) => p.name === "AI 회의록 파이프라인")!;
    const conv = await ai.createConversation({ scopeType: "PROJECT", scopeResourceId: aiProject.projectId });

    const controller = createAiStreamController();
    let completed = false, errored: any = null;
    controller.start(conv.conversationId, { content: "취소될 질문" }, {
      onCompleted: () => { completed = true; },
      onError: e => { errored = e; },
    });
    controller.cancel();
    expect(controller.active).toBe(false);

    await sleep(500); // mock 스트림이 계속 흘렀다면 이 시간 안에 완료/오류가 도착했을 것
    expect(completed, "취소 후 완료 콜백이 도착하면 안 됨").toBe(false);
    expect(errored, "취소는 일반 오류로 보고되면 안 됨").toBeNull();

    // 대화가 여전히 ACTIVE 상태로 남아 다음 질문을 받을 수 있어야 한다(서버 쪽 generating 잠금이 풀렸는지).
    const detail = await ai.getConversation(conv.conversationId);
    expect(detail.conversation.status).toBe("ACTIVE");
  });

  it("활성 스트림이 없을 때 cancel()을 호출해도 안전하다(아무 일도 하지 않음)", () => {
    const controller = createAiStreamController();
    expect(controller.active).toBe(false);
    expect(() => controller.cancel()).not.toThrow();
    expect(controller.active).toBe(false);
  });
});
