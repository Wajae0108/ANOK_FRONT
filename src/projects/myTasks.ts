// "내 업무" 데이터. project-service에 프로젝트 횡단 조회 API가 없어 접근 가능한 프로젝트마다 listTasks를 호출해 모은다.
// 홈과 내 업무 화면이 같은 데이터·같은 권한 규칙을 쓰도록 한곳에 둔다.
import * as api from "../api/project";
import type { ProjectRole, TaskResponse, TaskStatus } from "../api/project";
import { useLoad } from "../ui/kit";

export type MyTaskRow = TaskResponse & { projectName: string; myRoleInProject: ProjectRole };

export const MEMBER_NEXT: Record<TaskStatus, TaskStatus[]> = { TODO: ["IN_PROGRESS"], IN_PROGRESS: ["TODO", "DONE"], DONE: [], CANCELED: [] };
export const MANAGER_NEXT: Record<TaskStatus, TaskStatus[]> = { TODO: ["IN_PROGRESS", "CANCELED"], IN_PROGRESS: ["TODO", "DONE", "CANCELED"], DONE: ["IN_PROGRESS"], CANCELED: ["TODO"] };

/** 현재 사용자가 이 업무에서 바꿀 수 있는 다음 상태. 최종 판단은 서버가 한다. */
export function nextStatuses(row: MyTaskRow): TaskStatus[] {
  return row.myRoleInProject === "MANAGER" ? MANAGER_NEXT[row.status] : MEMBER_NEXT[row.status];
}

export const isOpenStatus = (s: TaskStatus) => s === "TODO" || s === "IN_PROGRESS";

// 서버는 "me" 같은 별칭 필터가 없다. assigneeUserId에는 본인 ID만 허용된다(다른 사람이면 TASK_FILTER_FORBIDDEN).
export async function loadMyTasks(userId: string): Promise<MyTaskRow[]> {
  const projects = (await api.listProjects({ limit: 100 })).items;
  const perProject = await Promise.all(projects.map(async p => {
    const tasks = (await api.listTasks(p.projectId, { assigneeUserId: userId, limit: 100 })).items;
    return tasks.map(t => ({ ...t, projectName: p.name, myRoleInProject: p.myRole }));
  }));
  return perProject.flat().sort((a, b) => (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999"));
}

export function useMyTasks(userId?: string) {
  return useLoad(() => (userId ? loadMyTasks(userId) : Promise.resolve([] as MyTaskRow[])), [userId]);
}
