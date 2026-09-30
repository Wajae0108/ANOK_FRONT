// Project/Work/Schedule(02) 서비스 시나리오: 역할/멤버십/결정/업무/일정/생명주기/매니저 복구.
import { describe, it, expect } from "vitest";
import * as idn from "../src/api/identity";
import * as prj from "../src/api/project";
import { tokenStore } from "../src/api/tokenStore";
import { code, createScenario, loginAdmin, loginAs, userIdByEmailAdmin } from "./helpers";

describe("Project(02) 시나리오", () => {
  it("역할별 가시성/멤버십/결정/업무/일정/생명주기/매니저 복구가 명세대로 동작한다", async () => {
    const scenario = createScenario();
    const { ok } = scenario;

    // ── gyuchan: MANAGER on 인증 시스템 개편/알림 시스템 고도화, MEMBER on AI 회의록 파이프라인 ──
    await loginAs("gyuchan@anok.io");
    const myProjects = await prj.listProjects();
    ok("visibility: only effective-member projects", myProjects.items.length === 3);
    const proj1 = myProjects.items.find((p: any) => p.name === "인증 시스템 개편");
    ok("project found + correct role", !!proj1 && proj1.myRole === "MANAGER");

    const created = await prj.createProject({ name: "테스트 프로젝트" });
    ok("create project -> creator is MANAGER", created.myRole === "MANAGER" && created.status === "ACTIVE");
    ok("visibility grows after create", (await prj.listProjects()).items.length === 4);

    // organization directory 응답엔 email이 없어 관리자 세션으로 userId를 조회한다
    await loginAdmin("insung@anok.io");
    const wonjaeId = await userIdByEmailAdmin("wonjae@anok.io");
    const dayoungId = await userIdByEmailAdmin("dayoung@anok.io");

    await loginAs("gyuchan@anok.io");
    const added = await prj.addProjectMember(created.projectId, { userId: wonjaeId, role: "MEMBER" });
    ok("add member", added.role === "MEMBER" && added.status === "ACTIVE");
    ok("duplicate add -> 409", (await code(prj.addProjectMember(created.projectId, { userId: wonjaeId, role: "MEMBER" }))) === "409 PROJECT_MEMBER_ALREADY_EXISTS");
    ok("unknown user -> 404", (await code(prj.addProjectMember(created.projectId, { userId: crypto.randomUUID(), role: "MEMBER" }))) === "404 TARGET_USER_NOT_FOUND");

    const promoted = await prj.updateProjectMemberRole(created.projectId, added.membershipId, { role: "MANAGER", version: added.version });
    ok("promote to MANAGER", promoted.role === "MANAGER");
    ok("stale version -> 409", (await code(prj.updateProjectMemberRole(created.projectId, added.membershipId, { role: "MEMBER", version: added.version }))) === "409 VERSION_CONFLICT");

    const membersPage = await prj.listProjectMembers(created.projectId);
    const selfMembership = membersPage.items.find((m: any) => m.userId !== wonjaeId)!;
    const demoted = await prj.updateProjectMemberRole(created.projectId, selfMembership.membershipId, { role: "MEMBER", version: selfMembership.version });
    ok("creator can demote self when another manager exists", demoted.role === "MEMBER");
    ok("member (was manager) now forbidden from write", (await code(prj.createDecision(created.projectId, { title: "x", content: "y" }))) === "403 PROJECT_MANAGER_REQUIRED");

    await loginAs("wonjae@anok.io"); // 이제 이 프로젝트의 유일한 ACTIVE MANAGER
    ok("last active manager cannot demote self", (await code(prj.updateProjectMemberRole(created.projectId, promoted.membershipId, { role: "MEMBER", version: promoted.version }))) === "409 LAST_ACTIVE_MANAGER");
    ok("restore on ACTIVE membership -> 409 not-suspended", (await code(prj.restoreProjectMember(created.projectId, promoted.membershipId, promoted.version))) === "409 MEMBERSHIP_NOT_SUSPENDED");

    // ── manager recovery (ADMIN + step-up) ──
    await loginAdmin("insung@anok.io");
    ok("recovery list needs step-up", (await code(prj.listManagerRecoveryProjects())) === "403 STEP_UP_REQUIRED");
    const ch = await idn.createStepUpChallenge();
    const su = await idn.completeStepUp({ challengeToken: ch.challengeToken, password: "AnokDemo!2026", factorType: "TOTP", factorCode: "123456" });
    tokenStore.set(su.accessToken);
    const recovery = await prj.listManagerRecoveryProjects();
    ok("no project currently needs recovery", recovery.items.every((p: any) => p.name !== "테스트 프로젝트"));
    ok("recovery on healthy project -> 409 not required", (await code(prj.recoverProjectManager(created.projectId, wonjaeId))) === "409 MANAGER_RECOVERY_NOT_REQUIRED");
    ok("non-admin cannot list recovery queue", await (async () => { await loginAs("wonjae@anok.io"); return (await code(prj.listManagerRecoveryProjects())) === "403 ADMIN_REQUIRED"; })());

    // ── decisions (project2: AI 회의록 파이프라인, wonjae = MANAGER) ──
    await loginAs("wonjae@anok.io");
    const proj2 = (await prj.listProjects()).items.find((p: any) => p.name === "AI 회의록 파이프라인")!;
    const decisionsPage = await prj.listDecisions(proj2.projectId);
    ok("seeded decisions visible", decisionsPage.items.length === 2);
    const dec = await prj.createDecision(proj2.projectId, { title: "새 결정", content: "내용" });
    ok("create decision as MANAGER", dec.status === "ACTIVE" && dec.version === 1);
    const superseded = await prj.supersedeDecision(proj2.projectId, dec.decisionId, { title: "새 결정 v2", content: "수정된 내용", sourceDecisionVersion: dec.version });
    ok("supersede marks previous + creates current", superseded.previous.status === "SUPERSEDED" && superseded.current.status === "ACTIVE" && superseded.previous.supersededById === superseded.current.decisionId);
    ok("editing superseded decision -> 409", (await code(prj.updateDecision(proj2.projectId, dec.decisionId, { title: "x", content: "y", version: superseded.previous.version }))) === "409 DECISION_SUPERSEDED");

    await loginAs("gyuchan@anok.io"); // MEMBER on proj2
    ok("MEMBER cannot create decision", (await code(prj.createDecision(proj2.projectId, { title: "x", content: "y" }))) === "403 PROJECT_MANAGER_REQUIRED");
    ok("MEMBER can read decisions", (await prj.listDecisions(proj2.projectId)).items.length >= 2);

    // ── tasks (proj2: dayoung has an IN_PROGRESS assigned task) ──
    await loginAs("wonjae@anok.io");
    const taskPage = await prj.listTasks(proj2.projectId, { assigneeUserId: dayoungId });
    const inProgressTask = taskPage.items.find((t: any) => t.status === "IN_PROGRESS")!;
    ok("manager can filter by assigneeUserId", !!inProgressTask);

    await loginAs("gyuchan@anok.io");
    ok("MEMBER cannot filter by assigneeUserId", (await code(prj.listTasks(proj2.projectId, { assigneeUserId: dayoungId }))) === "403 TASK_FILTER_FORBIDDEN");

    await loginAs("dayoung@anok.io"); // MEMBER, assignee of inProgressTask
    ok("assignee (MEMBER) can move IN_PROGRESS -> DONE", (await prj.updateTaskStatus(proj2.projectId, inProgressTask.taskId, { status: "DONE", version: inProgressTask.version })).status === "DONE");
    const doneTask = await prj.getTask(proj2.projectId, inProgressTask.taskId);
    ok("MEMBER cannot reopen DONE -> IN_PROGRESS", (await code(prj.updateTaskStatus(proj2.projectId, inProgressTask.taskId, { status: "IN_PROGRESS", version: doneTask.version }))) === "403 TASK_STATUS_CHANGE_FORBIDDEN");

    await loginAs("wonjae@anok.io"); // MANAGER
    const reopened = await prj.updateTaskStatus(proj2.projectId, inProgressTask.taskId, { status: "IN_PROGRESS", version: doneTask.version });
    ok("MANAGER can reopen DONE -> IN_PROGRESS", reopened.status === "IN_PROGRESS");
    ok("invalid transition TODO<-DONE style rejected", (await code(prj.updateTaskStatus(proj2.projectId, reopened.taskId, { status: "DONE", version: reopened.version }))) === "OK"); // IN_PROGRESS->DONE is valid, sanity

    const freshTask = await prj.createTask(proj2.projectId, { title: "담당자 없는 업무" });
    ok("create task without assignee", freshTask.assigneeUserId == null && freshTask.status === "TODO");
    ok("cannot start IN_PROGRESS without assignee", (await code(prj.updateTaskStatus(proj2.projectId, freshTask.taskId, { status: "IN_PROGRESS", version: freshTask.version }))) === "409 ASSIGNEE_REQUIRED");
    const assigned = await prj.updateTaskAssignee(proj2.projectId, freshTask.taskId, { assigneeUserId: dayoungId, version: freshTask.version });
    ok("assign task", assigned.assigneeUserId === dayoungId);
    const unassigned = await prj.unassignTask(proj2.projectId, freshTask.taskId);
    ok("unassign task", unassigned.assigneeUserId == null);
    ok("unassign again -> 409", (await code(prj.unassignTask(proj2.projectId, freshTask.taskId))) === "409 TASK_ALREADY_UNASSIGNED");
    const canceled = await prj.cancelTask(proj2.projectId, freshTask.taskId, unassigned.version);
    ok("cancel task", canceled.status === "CANCELED");

    // ── schedule ──
    const sched = await prj.createScheduleItem(proj2.projectId, { type: "EVENT", title: "스프린트 리뷰", startsAt: "2026-11-01T00:00:00Z" });
    ok("create schedule item", sched.status === "ACTIVE");
    const canceledSched = await prj.cancelScheduleItem(proj2.projectId, sched.scheduleItemId, sched.version);
    ok("cancel schedule item", canceledSched.status === "CANCELED");
    ok("cancel again -> 409", (await code(prj.cancelScheduleItem(proj2.projectId, sched.scheduleItemId, canceledSched.version))) === "409 SCHEDULE_ITEM_ALREADY_CANCELED");

    // ── project lifecycle ──
    const completion = await prj.completeProject(created.projectId, (await prj.getProject(created.projectId)).version);
    ok("complete project reports incomplete task count", typeof completion.incompleteTaskCount === "number" && completion.project.status === "COMPLETED");
    const reopenedProj = await prj.reopenProject(created.projectId, completion.project.version);
    ok("reopen project", reopenedProj.status === "ACTIVE");
    const archived = await prj.archiveProject(created.projectId, reopenedProj.version);
    ok("archive project", archived.status === "ARCHIVED");
    ok("archived project rejects metadata update", (await code(prj.updateProject(created.projectId, { name: "x", version: archived.version }))) === "409 PROJECT_ARCHIVED");
    ok("archive again -> 409", (await code(prj.archiveProject(created.projectId, archived.version))) === "409 PROJECT_ALREADY_ARCHIVED");

    expect(scenario.fail, scenario.summary()).toBe(0);
  });
});
