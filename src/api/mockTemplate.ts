// 회의 보고서 양식(문서 서비스 PUT /api/meetings/{id}/minutes-template)과 미팅 서비스가 공유하는 mock 저장소.
// 실제로는 미팅 서비스가 문서 서비스에 "이 회의의 현재 양식"을 물어본다. mockDocument ↔ mockMeeting의 순환 import를 피하려고 별도 모듈로 둔다.
export interface MockTemplate { templateId: string; meetingId: string; filename: string; mimeType: string; sizeBytes: number; sha256: string; uploadedAt: string }

const templates = new Map<string, MockTemplate>();

export const getMeetingTemplateFile = (meetingId: string) => templates.get(meetingId);
export function putMeetingTemplateFile(t: Omit<MockTemplate, "templateId"> & { templateId?: string }): MockTemplate {
  const prev = templates.get(t.meetingId);
  // 같은 내용(해시)을 다시 올리면 새로 저장하지 않고 같은 templateId와 처음 저장된 파일 이름을 돌려준다.
  if (prev && prev.sha256 === t.sha256) return prev;
  const next: MockTemplate = { ...t, templateId: t.templateId ?? crypto.randomUUID() };
  templates.set(t.meetingId, next);
  return next;
}
