# figma-make-app

React + Vite + Tailwind CSS project running inside Figma Make.

## Development Server

A Vite development server is **already running** on `$PORT` (default 8443). You don't need to start it manually.

- Preview URL: The user can access the running app through the preview panel
- Hot reload: Changes to source files are reflected immediately

## Project Structure

This is the canonical project structure. Start with task-relevant files below. Only follow imports or inspect other files when required, when a documented path is missing, or when the repository contradicts this guide.

- `src/main.tsx` - React entrypoint; imports `src/index.css` and mounts `src/App.tsx` into the `#root` element
- `src/App.tsx` - Primary application component and the usual starting point for UI work
- `src/index.css` - Global CSS entrypoint and Tailwind CSS v4 import
- `index.html` - Vite HTML shell containing the `#root` element and loading `src/main.tsx`
- `package.json` - Project dependencies and the Vite build, development, preview, and formatting scripts
- `vite.config.ts` - Vite configuration with React, Tailwind CSS v4, and Figma Make plugins plus the `@` alias for `src`
- `.mise.toml` - Toolchain versions for Node.js and pnpm

## Dependencies

- Runtime: React 19 and React DOM 19
- Styling: Tailwind CSS v4 with the `@tailwindcss/vite` plugin
- Build tooling: Vite 8, TypeScript 5.7, and `@vitejs/plugin-react`
- Formatting: oxfmt

## Styling

This project uses **Tailwind CSS v4** through the `@tailwindcss/vite` plugin configured in `vite.config.ts`. `src/index.css` imports Tailwind with `@import 'tailwindcss';`. Use Tailwind utility classes directly in JSX and put global CSS or Tailwind v4 theme customization in `src/index.css`. This scaffold does not need a Tailwind config file or PostCSS config.

`src/main.tsx` imports `src/index.css`, so global font wiring belongs in `src/index.css`. Keep CSS `@import` statements first, then add any `@font-face` rules and font-family defaults there.

## Testing

`src/api/mock*.ts`의 인메모리 mock을 통해 각 서비스(Identity/Project/Document/Meeting/Notification/AI)의 시나리오를 검증하는 통합 테스트가 `tests/`에 있다.

- 실행: `pnpm test` (vitest run, 1회 실행) 또는 `pnpm test:watch` (watch 모드)
- `tests/setup.ts`가 `window`/`sessionStorage`를 최소한으로 흉내 낸다(mock 계층이 브라우저 전역을 참조하므로 필요). `tests/helpers.ts`는 로그인/파일 생성 등 시나리오 공통 유틸을 모아둔다.
- 회의 후처리(postprocess)·AI 관련 시나리오는 mock이 실제 시간 경과를 흉내 내며 단계 전진하므로 개별 테스트 타임아웃이 기본값(5s)보다 길게 설정돼 있다(`vitest.config.ts`).
- vitest는 테스트 파일마다 모듈을 새로 로드하므로(`isolate: true`) 각 서비스의 인메모리 mock 상태는 파일 간에 공유되지 않는다 — 실행 순서를 바꾸거나 병렬로 돌려도 결과가 달라지지 않는다.

## Code quality

- Use double quotes for strings containing apostrophes (`"We're here to help"`), or escape them in single-quoted strings. An unescaped apostrophe in a single-quoted string breaks the build.
- Ensure JSX tags are closed and braces are balanced.
- Export components as default exports.
