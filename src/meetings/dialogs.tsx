// 회의 화면의 작은 입력 대화상자들(사유 입력, 사람 고르기). prompt()/confirm() 대신 쓴다 — 서버가 요구하는 길이·필수 조건을 입력칸에서 바로 알려 준다.
import { useState } from "react";
import * as prj from "../api/project";
import { errorText } from "../api/errors";
import { Field, ghostBtn, inputCls, Modal, primaryBtn, Spinner, useLoad } from "../ui/kit";

export function ReasonModal({ title, description, label = "사유", required = false, max = 1000, confirmLabel = "확인", danger = false, onClose, onSubmit }: {
  title: string; description?: string; label?: string; required?: boolean; max?: number; confirmLabel?: string; danger?: boolean;
  onClose: () => void; onSubmit: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = reason.trim();
  async function submit() {
    setBusy(true); setError(null);
    try { await onSubmit(trimmed); onClose(); }
    catch (e) { setError(errorText(e)); setBusy(false); }
  }
  return (
    <Modal title={title} onClose={onClose}>
      {description && <p className="text-[12px] text-slate-500 leading-relaxed">{description}</p>}
      <Field label={`${label}${required ? "" : " (선택)"}`}>
        <textarea rows={3} value={reason} maxLength={max} onChange={e => setReason(e.target.value)} className={inputCls} />
        <p className="text-[10px] text-slate-300 text-right mt-0.5">{trimmed.length}/{max}</p>
      </Field>
      {error && <p className="text-[12px] text-rose-500 font-medium">{error}</p>}
      <div className="flex gap-2">
        <button onClick={onClose} disabled={busy} className={`flex-1 ${ghostBtn}`}>취소</button>
        <button disabled={busy || (required && !trimmed)} onClick={submit}
          className={`flex-1 ${danger ? "px-4 py-2.5 bg-rose-500 hover:bg-rose-600 text-white text-[13px] font-bold rounded-xl transition-colors disabled:opacity-40" : primaryBtn}`}>{busy ? "처리 중..." : confirmLabel}</button>
      </div>
    </Modal>
  );
}

export interface PickOption { userId: string; label: string }

export function UserPickModal({ title, description, options, emptyText, withReason = false, confirmLabel = "확인", onClose, onSubmit }: {
  title: string; description?: string; options: PickOption[]; emptyText: string; withReason?: boolean; confirmLabel?: string;
  onClose: () => void; onSubmit: (userId: string, reason: string) => Promise<void>;
}) {
  const [userId, setUserId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true); setError(null);
    try { await onSubmit(userId, reason.trim()); onClose(); }
    catch (e) { setError(errorText(e)); setBusy(false); }
  }
  return (
    <Modal title={title} onClose={onClose}>
      {description && <p className="text-[12px] text-slate-500 leading-relaxed">{description}</p>}
      {options.length === 0 ? <p className="text-[12px] text-slate-400 py-3 text-center">{emptyText}</p> : (
        <Field label="대상">
          <select value={userId} onChange={e => setUserId(e.target.value)} className={inputCls}>
            <option value="">선택하세요</option>
            {options.map(o => <option key={o.userId} value={o.userId}>{o.label}</option>)}
          </select>
        </Field>
      )}
      {withReason && (
        <Field label="사유">
          <textarea rows={3} value={reason} maxLength={1000} onChange={e => setReason(e.target.value)} className={inputCls} />
        </Field>
      )}
      {error && <p className="text-[12px] text-rose-500 font-medium">{error}</p>}
      <div className="flex gap-2">
        <button onClick={onClose} disabled={busy} className={`flex-1 ${ghostBtn}`}>취소</button>
        <button disabled={busy || !userId || (withReason && !reason.trim())} onClick={submit} className={`flex-1 ${primaryBtn}`}>{busy ? "처리 중..." : confirmLabel}</button>
      </div>
    </Modal>
  );
}

// 프로젝트의 활성 구성원 중에서 고른다(참여자 추가·주최자 변경은 프로젝트 구성원만 대상이 된다).
export function ProjectMemberPickModal({ projectId, exclude, nameOf, ...rest }: {
  projectId: string; exclude: Set<string>; nameOf: (id?: string | null) => string;
} & Omit<Parameters<typeof UserPickModal>[0], "options" | "emptyText">) {
  const { data, loading } = useLoad(() => prj.listProjectMembers(projectId, { status: "ACTIVE", limit: 100 }), [projectId]);
  if (loading) return <Modal title={rest.title} onClose={rest.onClose}><Spinner /></Modal>;
  const options = (data?.items ?? []).filter(mem => !exclude.has(mem.userId)).map(mem => ({ userId: mem.userId, label: nameOf(mem.userId) }));
  return <UserPickModal {...rest} options={options} emptyText="선택할 수 있는 프로젝트 구성원이 없습니다." />;
}
