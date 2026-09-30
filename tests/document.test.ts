// Document/File(03) 서비스 시나리오: 업로드/다운로드/ACL/버전/프로젝트 첨부/처리/소유권 이전/보관.
import { describe, it, expect } from "vitest";
import * as doc from "../src/api/document";
import * as prj from "../src/api/project";
import { code, createScenario, loginAdmin, loginAs, loginSmart, makeFile, userIdByEmailAdmin } from "./helpers";

describe("Document(03) 시나리오", () => {
  it("업로드/ACL/버전/프로젝트 첨부/처리/소유권 이전/보관이 명세대로 동작한다", async () => {
    const scenario = createScenario();
    const { ok } = scenario;

    // gyuchan: 인증 시스템 개편 프로젝트 MANAGER; 시드 문서 "API 명세서 v2.1.pdf"의 OWNER
    await loginAs("gyuchan@anok.io");
    const listed = await doc.listDocuments();
    ok("직접 접근(OWNER/ACL) 문서만 목록에 보임", listed.items.length >= 1);
    const apiSpec = listed.items.find((d: any) => d.title === "API 명세서 v2.1.pdf");
    ok("시드 문서 OWNER 확인", !!apiSpec && apiSpec.effectivePermission === "OWNER");

    // 새 문서 업로드
    const created = await doc.uploadDocument(makeFile("설계서.txt", "hello world", "text/plain"), { title: "설계서 초안" });
    ok("업로드 → 생성자가 OWNER, processingStatus NOT_REQUESTED", created.effectivePermission === "OWNER" && created.processingStatus === "NOT_REQUESTED");
    const bigFile = new File([new Uint8Array(60 * 1024 * 1024)], "big.bin", { type: "application/octet-stream" });
    ok("50MB 초과 파일 거부", (await code(doc.uploadDocument(bigFile, { title: "big" }))) === "413 FILE_TOO_LARGE");
    ok("차단된 확장자 거부", (await code(doc.uploadDocument(makeFile("virus.exe", "x"), { title: "bad" }))) === "400 FILE_TYPE_NOT_ALLOWED");

    // 다운로드: 실제 업로드한 내용이 그대로 돌아오는지
    const dl = await doc.downloadCurrentVersion(created.documentId);
    const text = await dl.blob.text();
    ok("다운로드 바이너리가 업로드 내용과 동일", text === "hello world" && dl.filename === "설계서.txt");

    // 메타데이터 수정 + 민감도 승급/강등 규칙
    const updated = await doc.updateDocument(created.documentId, { title: "설계서 최종", sensitivityClassification: "CONFIDENTIAL", version: created.version });
    ok("제목/민감도 수정(OWNER)", updated.title === "설계서 최종" && updated.sensitivityClassification === "CONFIDENTIAL");
    ok("CONFIDENTIAL → INTERNAL 강등 금지", (await code(doc.updateDocument(created.documentId, { title: "x", sensitivityClassification: "INTERNAL", version: updated.version }))) === "409 SENSITIVITY_DOWNGRADE_FORBIDDEN");
    ok("민감 문서는 ALLOWED 정책 잠금", (await code(doc.updateDocumentAiPolicy(created.documentId, { externalAiPolicy: "ALLOWED", version: updated.version }))) === "409 DOCUMENT_AI_POLICY_LOCKED_BY_SENSITIVITY");

    // ACL: wonjae에게 VIEWER 부여
    await loginAdmin("insung@anok.io");
    const wonjaeId = await userIdByEmailAdmin("wonjae@anok.io");
    const dayoungId = await userIdByEmailAdmin("dayoung@anok.io");
    await loginAs("gyuchan@anok.io");
    const grant = await doc.upsertDocumentPermission(created.documentId, wonjaeId, { permission: "VIEWER", expectedDocumentVersion: updated.version });
    ok("ACL 부여", grant.permission === "VIEWER" && grant.status === "ACTIVE");

    await loginAs("wonjae@anok.io");
    const seenByWonjae = await doc.getDocument(created.documentId);
    ok("ACL VIEWER는 조회 가능, 수정 불가", seenByWonjae.effectivePermission === "VIEWER");
    ok("VIEWER는 메타데이터 수정 불가", (await code(doc.updateDocument(created.documentId, { title: "x", sensitivityClassification: "CONFIDENTIAL", version: seenByWonjae.version }))) === "403 DOCUMENT_EDIT_FORBIDDEN");
    ok("VIEWER도 다운로드는 가능", (await doc.downloadCurrentVersion(created.documentId)).filename === "설계서.txt");

    // EDITOR로 승격 후 제목은 되지만 민감도 변경은 막힘
    await loginAs("gyuchan@anok.io");
    await doc.upsertDocumentPermission(created.documentId, wonjaeId, { permission: "EDITOR", expectedDocumentVersion: seenByWonjae.version });
    await loginAs("wonjae@anok.io");
    const asEditor = await doc.getDocument(created.documentId);
    const editByEditor = await doc.updateDocument(created.documentId, { title: "에디터가 수정", sensitivityClassification: asEditor.sensitivityClassification, version: asEditor.version });
    ok("EDITOR는 제목 수정 가능(민감도 동일 유지 시)", editByEditor.title === "에디터가 수정");
    ok("EDITOR가 민감도 변경 시도 → 403", (await code(doc.updateDocument(created.documentId, { title: "x", sensitivityClassification: "PII", version: editByEditor.version }))) === "403 DOCUMENT_OWNER_REQUIRED");
    ok("EDITOR는 ACL 조회 불가(OWNER 전용)", (await code(doc.listDocumentPermissions(created.documentId))) === "403 DOCUMENT_OWNER_REQUIRED");

    // 버전 관리
    await loginAs("gyuchan@anok.io");
    const afterEdit = await doc.getDocument(created.documentId);
    const v2 = await doc.uploadDocumentVersion(created.documentId, makeFile("설계서_v2.txt", "revised content"), afterEdit.version);
    ok("새 버전 업로드 → current 교체", v2.isCurrent === true && v2.versionNo === 2);
    const versions = await doc.listDocumentVersions(created.documentId);
    ok("버전 목록 2건", versions.page.total === 2);
    ok("stale expectedDocumentVersion → 409", (await code(doc.uploadDocumentVersion(created.documentId, makeFile("x.txt", "x"), afterEdit.version))) === "409 VERSION_CONFLICT");

    // 프로젝트 첨부: gyuchan은 "인증 시스템 개편" MANAGER
    const myProjects = await prj.listProjects();
    const authProject = myProjects.items.find((p: any) => p.name === "인증 시스템 개편")!;
    const attach = await doc.attachDocumentToProject(created.documentId, authProject.projectId);
    ok("프로젝트 첨부", attach.projectId === authProject.projectId);
    ok("중복 첨부 → 409", (await code(doc.attachDocumentToProject(created.documentId, authProject.projectId))) === "409 PROJECT_ATTACHMENT_ALREADY_EXISTS");

    // seoyeon: 같은 프로젝트 MEMBER, 이 문서엔 explicit ACL 없음 → project-inherited VIEWER
    await loginSmart("seoyeon@anok.io");
    const viaInherited = await doc.getDocument(created.documentId);
    ok("프로젝트 상속 VIEWER", viaInherited.effectivePermission === "VIEWER" && viaInherited.permissionSource === "PROJECT_INHERITED");

    // dayoung: 이 프로젝트 멤버 아님 → 접근 거부
    await loginSmart("dayoung@anok.io");
    void dayoungId;
    ok("무관한 사용자는 접근 거부", (await code(doc.getDocument(created.documentId))) === "403 DOCUMENT_ACCESS_DENIED");

    // 첨부 해제 후 상속 권한 소멸
    await loginAs("gyuchan@anok.io");
    await doc.detachDocumentFromProject(created.documentId, authProject.projectId);
    await loginSmart("seoyeon@anok.io");
    ok("첨부 해제 후 상속 VIEWER 소멸", (await code(doc.getDocument(created.documentId))) === "403 DOCUMENT_ACCESS_DENIED");

    // 처리(processing) 상태
    await loginAs("gyuchan@anok.io");
    const proc1 = await doc.requestDocumentProcessing(created.documentId);
    ok("처리 요청 → QUEUED", proc1.status === "QUEUED" && proc1.processingGeneration === 1);
    ok("이미 실행 중 재요청 → 409", (await code(doc.requestDocumentProcessing(created.documentId))) === "409 PROCESSING_ALREADY_RUNNING");

    // 소유권 이전
    const transferred = await doc.transferDocumentOwner(created.documentId, { targetUserId: wonjaeId, version: (await doc.getDocument(created.documentId)).version });
    ok("소유권 이전", transferred.ownerUserId === wonjaeId);
    ok("이전 소유자는 ACL도 없어 완전히 접근 상실", (await code(doc.getDocument(created.documentId))) === "403 DOCUMENT_ACCESS_DENIED");

    // 보관
    await loginAs("wonjae@anok.io");
    const archived = await doc.archiveDocument(created.documentId, transferred.version);
    ok("보관 처리", archived.status === "ARCHIVED");
    ok("보관된 문서 수정 금지", (await code(doc.updateDocument(created.documentId, { title: "x", sensitivityClassification: archived.sensitivityClassification, version: archived.version }))) === "409 DOCUMENT_ARCHIVED");
    ok("중복 보관 → 409", (await code(doc.archiveDocument(created.documentId, archived.version))) === "409 DOCUMENT_ALREADY_ARCHIVED");

    expect(scenario.fail, scenario.summary()).toBe(0);
  });
});
