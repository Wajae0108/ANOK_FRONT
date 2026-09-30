Design a complete UI/UX system for an enterprise AI work-management platform called “Anok”.

Anok is an AI-based company work integration system that connects:
Meetings → AI transcription → AI meeting minutes → task extraction → assignee selection → approval → task creation → schedules → notifications → company knowledge search.

The product consists of TWO different clients:

1. [WEB] Main management dashboard
2. [DESKTOP] Lightweight always-running desktop work assistant

Do NOT design the Desktop client as a smaller copy of the Web application.

The WEB application is for:
- management
- reviewing
- organizing
- editing
- project control
- meeting-minutes approval
- task assignment
- documents
- company administration

The DESKTOP application is for:
- immediate actions
- meeting participation
- meeting control
- quick task checking
- quick AI questions
- real-time notifications
- opening detailed pages in Web

==================================================
USER ROLES
==================================================

There are three main UX personas.

[ADMIN / 관리자]

Company-level administrator.

Main responsibilities:
- employee management
- department management
- team management
- company settings
- company policies
- company-level status monitoring

IMPORTANT:
Administrators must NOT automatically have access to every company document.
Restricted or confidential documents should show an “Access Restricted” state when permission is missing.

[EMPLOYEE / 일반 사원]

Normal employee.

Main responsibilities:
- check assigned tasks
- participate in projects
- join meetings
- read permitted documents
- check schedule
- receive notifications
- use AI company knowledge assistant

Employees must only see resources they are allowed to access.

[MANAGER / 담당자]

A project or meeting responsible person.
This persona represents roles such as Project Manager and Meeting Organizer.

Additional responsibilities:
- manage projects
- manage project members
- create and assign tasks
- manage schedules
- create meetings
- edit meetings
- manage participants
- start/end meetings
- review AI-generated meeting minutes
- review AI-extracted task candidates
- assign task owners and deadlines
- approve final meeting minutes

The Manager UI should extend the Employee UI instead of being an entirely separate product.

==================================================
VISUAL STYLE
==================================================

Create a modern Korean enterprise SaaS design.

Style:
- professional
- minimal
- calm
- high readability
- productivity focused
- not overly futuristic
- AI features should feel trustworthy and practical

Use:
- light neutral backgrounds
- white cards
- subtle gray borders
- navy / indigo / blue as primary accent
- clear status colors
- rounded cards but not excessively playful
- generous whitespace
- strong information hierarchy

Typography must support Korean clearly.

Use Korean text for all actual UI labels.

Example labels:
대시보드
프로젝트
내 업무
회의
문서
일정
AI
알림
구성원
직원 관리
부서 관리
팀 관리
회사 설정

Design everything using:
- Auto Layout
- reusable components
- component variants
- consistent spacing system
- responsive constraints
- clear design tokens

Create variants for:
default / hover / active / disabled / loading / error / empty / selected.

==================================================
GLOBAL WEB STRUCTURE
==================================================

WEB layout:

LEFT SIDEBAR
- Anok Logo
- 대시보드
- 프로젝트
- 업무
- 일정
- 회의
- 문서
- AI
- 알림

Role-specific additional items:
ADMIN:
- 직원 관리
- 조직 관리
- 회사 설정

MANAGER:
- 구성원 관리 where contextually appropriate

TOP HEADER
- breadcrumb
- page title
- global search
- notification icon with unread badge
- user avatar
- profile dropdown

Create:
- toast notification
- modal
- confirm dialog
- dropdown
- tabs
- badge
- avatar
- table
- card
- date picker
- search bar
- file uploader
- loading skeleton
- empty state
- access denied state
- error state

==================================================
[WEB] ADMIN SCREENS
==================================================

Create an Admin dashboard.

Screen ID:
WEB-ADM-001

Dashboard cards:
- 전체 직원
- 진행 프로젝트
- 오늘 회의
- 진행 중 업무
- 미확인 알림

Include an organization overview.

Example:

개발부
 ├ 백엔드팀
 └ 프론트엔드팀

기획부
 └ 프로덕트팀

Create screens:

WEB-ADM-002 직원 관리
- employee list
- search
- department filter
- team filter
- account status
- active / inactive status
- employee details

WEB-ADM-003 조직 관리
- departments
- teams
- employee assignments
- organization tree

WEB-ADM-004 회사 설정
- company profile
- basic policies
- account settings

WEB-ADM-005 프로젝트 현황
- project cards/table
- project status
- member count
- progress summary

WEB-ADM-006 관리자 알림

IMPORTANT DOCUMENT UX:
If the administrator does not have permission for a document, show:

🔒 접근 권한 없음

Do not show unauthorized document content.

==================================================
[WEB] EMPLOYEE SCREENS
==================================================

Create a personalized employee dashboard.

Screen ID:
WEB-EMP-001

Header:
“좋은 오후입니다, 원재님”

Dashboard widgets:

오늘 할 일
- 업무명
- 마감일
- 상태
- 우선순위

오늘 회의
- 시간
- 회의명
- 참여 버튼

내 프로젝트
- project name
- role
- status

다가오는 일정

최근 알림

Create:

WEB-EMP-002 내 프로젝트

Project cards:
- 프로젝트명
- 상태
- 내 역할
- 진행률

WEB-EMP-003 프로젝트 상세

Tabs:
개요 | 업무 | 회의 | 문서 | 일정

Normal employees should NOT see management actions they cannot perform.

WEB-EMP-004 내 업무

Provide two views:
- List View
- Kanban View

Kanban columns:
TODO
IN PROGRESS
DONE

Task card:
- 업무명
- 담당자
- 마감일
- 우선순위
- 프로젝트

WEB-EMP-005 업무 상세
- title
- project
- status
- assignee
- priority
- due date
- description
- related meeting

WEB-EMP-006 회의 목록

Sections:
오늘
예정
지난 회의

Meeting card:
- title
- time
- organizer
- participant count
- status

Meeting statuses:
예정
진행 중
종료
취소

WEB-EMP-007 회의 상세

For participants:
- meeting information
- agenda
- participants
- attached documents
- join meeting button

WEB-EMP-008 승인된 회의록

Show:
- meeting summary
- decisions
- assigned tasks
- participants
- related documents

WEB-EMP-009 문서

Provide:
- file list
- file type
- uploader
- download
- permitted project documents
- permitted meeting attachments

WEB-EMP-010 일정

Calendar view:
- meeting events
- task deadlines
- project schedule

WEB-EMP-011 AI Assistant

Chat interface.

Example question:
“어제 회의에서 내가 맡은 업무가 뭐야?”

AI answer should visually reference:
- meeting
- task
- document
- date

Provide citation/source cards inside the AI response.

WEB-EMP-012 알림센터

Notification types:
- 업무 배정
- 회의 예정
- 회의록 생성
- 마감 임박
- 일정
- 문서

Provide unread/read states and:
“모두 읽음 처리”

==================================================
[WEB] MANAGER SCREENS
==================================================

Manager should inherit Employee screens.

Add management actions.

WEB-MGR-001 Manager Project Detail

Tabs:
개요 | 업무 | 회의 | 문서 | 일정 | 구성원

Top actions:
+ 업무 추가
+ 회의 생성
구성원 관리

WEB-MGR-002 업무 생성

Form:
업무명
설명
담당자
우선순위
마감일
프로젝트

WEB-MGR-003 구성원 관리

Show:
- member
- role
- team
- project permission

Actions:
추가
역할 변경
제거

WEB-MGR-004 회의 생성

Fields:
회의 제목
설명
날짜
시간
안건
참가자
프로젝트
회의 비밀번호

Buttons:
취소
회의 생성

WEB-MGR-005 회의 관리

Show:
- meeting title
- schedule
- participants
- agenda
- related project
- attached files

Actions:
회의 수정
참가자 관리
자료 추가
회의 시작

WEB-MGR-006 AI 회의록 처리중

Show a clear progress UX:

회의가 종료되었습니다.

AI가 회의 내용을 분석하고 있습니다.

✓ 녹음 완료
✓ 음성 → 텍스트 변환
● 회의록 생성 중
○ 업무 후보 추출

Avoid fake precise percentages.
Use process states instead.

WEB-MGR-007 AI 회의록 검토

This is one of the MOST IMPORTANT screens in the product.

Layout:

회의록 초안

[회의 요약]

[주요 논의]

[결정사항]

[AI 추출 업무]

Each AI task candidate should have:

checkbox
업무명
담당자 dropdown
마감일
우선순위
관련 프로젝트

Example:

☑ Front 회의 UI 개발
담당자 [원재 ▼]
마감일 [2026.09.25]
우선순위 [높음 ▼]

Show a notice:

“AI가 회의 내용을 기반으로 생성한 초안입니다.
승인 전 내용을 확인해주세요.”

Actions:
초안 수정
저장
최종 승인

Primary CTA:
최종 승인

Approval should visually communicate:

회의록 승인
→ 업무 생성
→ 담당자 알림

==================================================
DESKTOP APPLICATION PRINCIPLE
==================================================

The Desktop client must be compact.

It runs automatically when the computer starts and stays available through a tray icon.

Do NOT include full:
- employee management
- department management
- full document management
- complex project editing
- company settings

Those tasks should open the WEB application.

Desktop should use:
- compact floating panel
- tray popover
- desktop notification
- meeting window
- quick-action UI

==================================================
[DESKTOP] EMPLOYEE
==================================================

DESK-EMP-001 Quick Home

Compact window.

ANOK

오늘 업무        3
예정 회의        1
새 알림          2

Next meeting:

14:00
Anok 개발회의

[회의 입장]

My tasks:

API 연동          D-2
화면 테스트       D-4

[전체 보기 ↗]

“전체 보기” opens the WEB application.

DESK-EMP-002 Meeting Reminder Notification

“10분 후 회의가 시작됩니다.”

Anok 개발회의
14:00

[회의 입장]
[나중에 알림]

DESK-EMP-003 Meeting Participant Window

Show:
- meeting timer
- participants
- current speaker
- microphone status
- mute/unmute
- attachments
- leave meeting

Current speaker should have a clear active visual state.

DESK-EMP-004 Quick AI

Small AI popup.

Placeholder:
“회사 업무에 대해 질문해보세요.”

Examples:
- 오늘 내가 해야 할 업무 알려줘
- 다음 회의가 언제야?
- 어제 회의 결정사항 보여줘

DESK-EMP-005 Notifications

Compact notification center.

==================================================
[DESKTOP] MANAGER
==================================================

Manager inherits employee desktop features.

Add meeting control functionality.

DESK-MGR-001 Meeting Preparation

Anok 개발회의
14:00

참가 예정자

원재      접속
규찬      접속
인성      미접속

첨부자료

API 명세서.pdf

[+ 자료 추가]

Primary CTA:
[회의 시작]

DESK-MGR-002 Live Meeting Control

ANOK Meeting

Meeting timer

Participants:
원재 🎤
규찬 🔇
인성 🎤

Show active speaker.

Manager actions:
마이크
자료
참가자
회의 종료

The “회의 종료” action must be visually separated and require confirmation.

DESK-MGR-003 Meeting End Confirmation

“회의를 종료하시겠습니까?”

종료 후 AI가 회의 내용을 분석하고
회의록 초안을 생성합니다.

[취소]
[회의 종료]

DESK-MGR-004 AI Processing

회의가 종료되었습니다.

✓ 녹음 완료
● 음성 분석 중
○ 회의록 생성
○ 업무 추출

[백그라운드에서 처리]

DESK-MGR-005 Meeting Minutes Ready Notification

“회의록 초안이 생성되었습니다.”

Anok 개발회의

[검토하기]

Clicking 검토하기 must open:
WEB-MGR-007 AI 회의록 검토

==================================================
[DESKTOP] ADMIN
==================================================

Desktop Admin should remain lightweight.

DESK-ADM-001 Admin Quick Overview

ANOK 관리자

오늘 회의       12
마감 임박 업무   7
새 알림          5

[관리자 페이지 열기]

DESK-ADM-002 Admin Notifications

Examples:
- 직원 계정 상태 변경
- 프로젝트 관련 알림
- 관리자 작업 알림

Full administration must open WEB.

==================================================
ROLE BASED UX
==================================================

Use the SAME base design system.

Do not create six unrelated products.

Role differences should primarily appear through:
- navigation visibility
- available tabs
- action buttons
- editing capability
- approval capability
- management actions

Example Project screen:

EMPLOYEE:

Anok
[개요] [업무] [회의] [문서] [일정]

MANAGER:

Anok
[개요] [업무] [회의] [문서] [일정] [구성원]

+ 업무
+ 회의
구성원 관리

ADMIN:
show only actions allowed by company/project permissions.

Do not rely only on disabled controls.
Hide irrelevant actions when appropriate.

==================================================
CORE USER FLOW
==================================================

Create a clickable prototype for the most important Anok flow:

1. Manager opens WEB
2. Creates a meeting
3. Participants receive Desktop meeting notification
4. Employee joins through Desktop
5. Manager starts meeting through Desktop
6. Meeting is conducted
7. Manager ends meeting
8. Desktop shows AI Processing
9. AI meeting minutes become ready
10. Manager clicks “검토하기”
11. WEB AI meeting-minutes review opens
12. Manager reviews AI-extracted tasks
13. Manager selects assignees
14. Manager sets deadlines
15. Manager approves meeting minutes
16. Tasks are created
17. Employee receives Desktop notification
18. Employee sees new task in WEB dashboard

This flow should be visually understandable without explanation.

==================================================
FIGMA OUTPUT STRUCTURE
==================================================

Organize the Figma file into pages:

00_Cover
01_Design_System
02_WEB_Common
03_WEB_Admin
04_WEB_Employee
05_WEB_Manager
06_DESKTOP_Common
07_DESKTOP_Admin
08_DESKTOP_Employee
09_DESKTOP_Manager
10_Prototype_Flow

Create reusable components first.

Use clear frame names such as:

WEB-ADM-001_Admin_Dashboard
WEB-EMP-001_Employee_Dashboard
WEB-MGR-007_AI_Minutes_Review
DESK-EMP-001_Quick_Home
DESK-MGR-002_Live_Meeting
DESK-MGR-005_Minutes_Ready

The final design should look like a realistic, production-ready Korean B2B SaaS product rather than a concept-only student project.