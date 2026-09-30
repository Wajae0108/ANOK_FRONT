import { defineConfig } from "vitest/config";

// mock 계층은 브라우저 전역(window/sessionStorage)에 의존하므로 environment는 node로 두고
// tests/setup.ts에서 최소한의 폴리필만 제공한다(jsdom 등 무거운 DOM 구현은 필요 없음).
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    // 회의 후처리(postprocess) 시나리오는 mock이 실제 시간 경과를 흉내 내며 단계 전진하므로 기본 5s 제한보다 여유가 필요하다.
    testTimeout: 30000,
    // 파일마다 완전히 새 모듈 인스턴스를 사용해 mock의 인메모리 상태가 테스트 파일 간에 섞이지 않게 한다.
    isolate: true,
    fileParallelism: true,
  },
});
