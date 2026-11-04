// 회의록(Markdown) 안전 렌더러. AI가 만든 문서이므로 HTML을 해석하지 않는다 — 모든 글자는 React 텍스트 노드로만 출력되고,
// 링크·이미지는 클릭 가능한 요소로 만들지 않는다(원문 글자만 보여 준다). 지원: 제목, 목록, 번호 목록, 인용, 코드 블록, 표, 굵게/기울임/인라인 코드.
import { Fragment } from "react";
import type { ReactNode } from "react";

function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  // 코드(`) → 굵게(**) → 기울임(*) 순으로 쪼갠다. 링크 [글자](주소)는 글자만 남긴다.
  const src = text.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1");
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(src))) {
    if (m.index > last) out.push(src.slice(last, m.index));
    const tok = m[0];
    const k = `${keyPrefix}-${i++}`;
    if (tok.startsWith("`")) out.push(<code key={k} className="px-1 py-0.5 rounded bg-slate-100 text-[12px] font-mono">{tok.slice(1, -1)}</code>);
    else if (tok.startsWith("**")) out.push(<strong key={k} className="font-bold">{tok.slice(2, -2)}</strong>);
    else out.push(<em key={k}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < src.length) out.push(src.slice(last));
  return out;
}

const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const isTableSep = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const cells = (l: string) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim());

export default function Markdown({ source, className = "" }: { source: string; className?: string }) {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0, key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const fence = /^\s*```/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      i++;
      blocks.push(<pre key={key++} className="bg-slate-50 border border-slate-100 rounded-xl p-3 text-[12px] font-mono overflow-x-auto whitespace-pre">{body.join("\n")}</pre>);
      continue;
    }

    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const cls = level === 1 ? "text-[16px] font-extrabold mt-1" : level === 2 ? "text-[14px] font-bold mt-1" : "text-[13px] font-bold";
      blocks.push(<p key={key++} role="heading" aria-level={level} className={`${cls} text-slate-800`}>{inline(h[2], `h${key}`)}</p>);
      i++;
      continue;
    }

    if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) rows.push(cells(lines[i++]));
      blocks.push(
        <div key={key++} className="overflow-x-auto">
          <table className="w-full text-[12px] border border-slate-100">
            <thead><tr className="bg-slate-50">{head.map((c, j) => <th key={j} className="text-left font-semibold text-slate-500 px-2 py-1 border-b border-slate-100">{inline(c, `th${key}-${j}`)}</th>)}</tr></thead>
            <tbody>{rows.map((r, ri) => <tr key={ri}>{head.map((_, j) => <td key={j} className="px-2 py-1 border-b border-slate-50 align-top">{inline(r[j] ?? "", `td${key}-${ri}-${j}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ""));
      blocks.push(<blockquote key={key++} className="border-l-2 border-slate-200 pl-3 text-slate-500">{body.map((b, j) => <Fragment key={j}>{j > 0 && <br />}{inline(b, `q${key}-${j}`)}</Fragment>)}</blockquote>);
      continue;
    }

    const ul = /^\s*[-*+]\s+/;
    const ol = /^\s*\d+[.)]\s+/;
    if (ul.test(line) || ol.test(line)) {
      const ordered = ol.test(line);
      const re = ordered ? ol : ul;
      const items: string[] = [];
      while (i < lines.length && re.test(lines[i])) items.push(lines[i++].replace(re, ""));
      const Tag = ordered ? "ol" : "ul";
      blocks.push(<Tag key={key++} className={`${ordered ? "list-decimal" : "list-disc"} pl-5 space-y-0.5`}>{items.map((t, j) => <li key={j}>{inline(t, `li${key}-${j}`)}</li>)}</Tag>);
      continue;
    }

    // 문단: 빈 줄이나 다른 블록이 나올 때까지 이어 붙인다.
    const para: string[] = [lines[i++]]; // 첫 줄은 무조건 먹는다(어떤 줄이든 반드시 앞으로 나아가도록)
    while (i < lines.length && lines[i].trim() && !/^\s*```/.test(lines[i]) && !/^#{1,6}\s/.test(lines[i]) && !ul.test(lines[i]) && !ol.test(lines[i]) && !/^\s*>/.test(lines[i])) para.push(lines[i++]);
    blocks.push(<p key={key++}>{para.map((p, j) => <Fragment key={j}>{j > 0 && <br />}{inline(p, `p${key}-${j}`)}</Fragment>)}</p>);
  }
  return <div className={`text-[13px] text-slate-700 leading-relaxed space-y-2 break-words ${className}`}>{blocks}</div>;
}
