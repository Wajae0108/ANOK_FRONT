// vitest setupFiles: 각 테스트 파일마다 새로 실행된다(vitest의 파일 단위 모듈 격리와 짝을 이룸).
// src/api/mock.ts는 sessionStorage를, src/api/http.ts는 window.location.origin을 브라우저 전역으로 가정하므로
// node 환경에서 최소한으로만 흉내 낸다.
const store = new Map<string, string>();
(globalThis as any).sessionStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};
(globalThis as any).window = { location: { origin: "http://localhost" } };
