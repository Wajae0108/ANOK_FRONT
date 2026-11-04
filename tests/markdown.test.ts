// 회의록(AI가 만든 Markdown)은 HTML로 해석하지 않는다(FRONTEND_00 4-9). 서버 렌더링 결과로 직접 확인한다.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Markdown from "../src/ui/Markdown";

const html = (src: string) => renderToStaticMarkup(createElement(Markdown, { source: src }));

describe("Markdown 렌더러", () => {
  it("원시 HTML과 스크립트를 태그로 출력하지 않는다", () => {
    const out = html('# 제목\n\n<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n- <b onclick="x()">굵게</b>');
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/<img/i);
    expect(out).not.toMatch(/<b[ >]/i);
    expect(out).toContain("&lt;script&gt;");
    expect(out).toContain("&lt;img");
  });

  it("링크·이미지 문법은 클릭 가능한 요소가 되지 않고 글자만 남는다", () => {
    const out = html("[클릭](javascript:alert(1)) 와 ![그림](http://evil/x.png)");
    expect(out).not.toMatch(/<a[ >]/i);
    expect(out).not.toMatch(/<img/i);
    expect(out).not.toMatch(/href=/i);
    expect(out).toContain("클릭");
  });

  it("제목·목록·번호 목록·코드·표·인용·굵게를 구조로 그린다", () => {
    const out = html("## 요약\n\n- 하나\n- 둘\n\n1. 첫째\n2. 둘째\n\n> 인용문\n\n```\nconst a = 1;\n```\n\n| 이름 | 값 |\n| --- | --- |\n| a | **b** |\n\n일반 `코드` 문장");
    expect(out).toContain('role="heading"');
    expect(out).toMatch(/<ul[^>]*>.*<li>하나<\/li>.*<\/ul>/);
    expect(out).toMatch(/<ol[^>]*>.*<li>첫째<\/li>/);
    expect(out).toContain("<blockquote");
    expect(out).toContain("const a = 1;");
    expect(out).toMatch(/<table[\s\S]*<th[^>]*>이름<\/th>[\s\S]*<strong[^>]*>b<\/strong>/);
    expect(out).toMatch(/<code[^>]*>코드<\/code>/);
  });

  it("이상한 입력(빈 문자열, 닫히지 않은 코드 블록, 7개짜리 #)에서도 멈추지 않는다", () => {
    expect(html("")).toBeTruthy();
    expect(html("```\n닫히지 않음")).toContain("닫히지 않음");
    expect(html("####### 일곱\n|\n-\n>")).toContain("일곱");
  });
});
