# Claude Code Discord Controller

Discord에서 여러 프로젝트의 Claude Code 세션을 원격 관리하는 봇입니다. (데스크톱/웹/모바일)

채널별로 독립적인 Claude Code 세션을 실행하고, tool use 승인/거절을 Discord 버튼으로 제어할 수 있습니다.

## 주요 기능

- 📱 Discord에서 Claude Code 원격 제어 (데스크톱/웹/모바일)
- 🔀 채널별 독립 세션 (프로젝트 디렉토리 매핑)
- ✅ tool use 승인/거절 Discord 버튼 UI
- ❓ 질문 인터랙티브 UI (선택지 버튼 + 직접 입력)
- ⏹️ 진행 중 Stop 버튼으로 즉시 중지
- 📎 이미지, 문서, 코드 등 파일 첨부 지원
- 🔄 세션 재개/삭제/새로 만들기 (봇 재시작 후에도 유지, 마지막 대화 미리보기)
- 📨 작업 중 메시지 큐 (현재 작업 완료 후 자동 처리)
- ⏱️ 실시간 진행 상황 표시 (도구 사용 현황, 경과 시간)
- 🔒 유저 화이트리스트, 레이트리밋, 경로 보안, 중복 실행 방지

## 기술 스택

| 분류 | 기술 |
|------|------|
| Runtime | Node.js 20+, TypeScript |
| Discord | discord.js v14 |
| AI | @anthropic-ai/claude-agent-sdk |
| DB | better-sqlite3 (SQLite) |
| 검증 | zod v4 |
| 빌드 | tsup (ESM) |
| 테스트 | vitest |

## 설치

```bash
git clone git@github.com:chadingTV/claudecode-discord.git
cd claudecode-discord

# 자동 설치 (Node.js, Claude Code CLI, npm 패키지 일괄 설치)
./install.sh        # macOS / Linux
install.bat         # Windows

# 또는 수동 설치
npm install
cp .env.example .env
npm run dev
```

Discord 봇 생성, 환경변수 상세 설정, Windows 환경 안내, Claude Code 설치 방법 등
전체 셋업 과정은 **[SETUP.kr.md](SETUP.kr.md)** 를 참고하세요.

## 프로젝트 구조

```
claudecode-discord/
├── install.sh              # macOS/Linux 자동 설치 스크립트
├── install.bat             # Windows 자동 설치 스크립트
├── mac-start.sh            # macOS 백그라운드 실행 + 메뉴바
├── menubar/                # macOS 메뉴바 상태 앱 (Swift)
├── .env.example            # 환경변수 템플릿
├── src/
│   ├── index.ts            # 엔트리포인트
│   ├── bot/
│   │   ├── client.ts       # Discord 봇 초기화 & 이벤트
│   │   ├── commands/       # 슬래시 명령어
│   │   │   ├── register.ts
│   │   │   ├── unregister.ts
│   │   │   ├── status.ts
│   │   │   ├── stop.ts
│   │   │   ├── auto-approve.ts
│   │   │   ├── sessions.ts
│   │   │   ├── last.ts
│   │   │   └── clear-sessions.ts
│   │   └── handlers/       # 이벤트 핸들러
│   │       ├── message.ts
│   │       └── interaction.ts
│   ├── claude/
│   │   ├── session-manager.ts   # 세션 생명주기 관리
│   │   └── output-formatter.ts  # Discord 출력 포맷
│   ├── db/
│   │   ├── database.ts     # SQLite 초기화 & 쿼리
│   │   └── types.ts
│   ├── security/
│   │   └── guard.ts        # 인증, rate limit
│   └── utils/
│       └── config.ts       # 환경변수 검증 (zod)
├── SETUP.md / SETUP.kr.md  # 상세 셋업 가이드
├── package.json
└── tsconfig.json
```

## 사용법

| 명령어 | 설명 | 예시 |
|--------|------|------|
| `/register <폴더명>` | 현재 채널에 프로젝트 연결 | `/register my-project` |
| `/unregister` | 채널 등록 해제 | |
| `/status` | 전체 세션 상태 확인 | |
| `/stop` | 현재 채널 세션 중지 | |
| `/auto-approve on\|off` | 자동 승인 토글 | `/auto-approve on` |
| `/sessions` | 기존 세션 목록 조회, 재개 또는 삭제 | |
| `/last` | 현재 세션의 마지막 Claude 응답 전체 확인 | |
| `/clear-sessions` | 해당 프로젝트의 모든 세션 일괄 삭제 | |

`/register`의 경로는 `.env`에 설정한 `BASE_PROJECT_DIR` 기준으로 해석됩니다.
예: `BASE_PROJECT_DIR=/Users/you/projects`이면 `/register my-project` → `/Users/you/projects/my-project`. 절대 경로도 가능: `/register path:/Users/you/other/project`.

등록된 채널에 **일반 메시지**를 보내면 Claude가 응답합니다.
이미지, 문서, 코드 파일을 첨부하면 Claude가 읽고 분석할 수 있습니다.

### 진행 중 제어

- 작업 진행 중 **⏹️ Stop** 버튼으로 즉시 중지 가능
- 이전 작업 진행 중 새 메시지를 보내면 **메시지 큐**에 추가 가능 — 현재 작업 완료 후 자동 처리
- `/stop` 슬래시 명령어로도 중지 가능

## 아키텍처

```
[모바일 Discord] ←→ [Discord Bot] ←→ [Session Manager] ←→ [Claude Agent SDK]
                          ↕
                     [SQLite DB]
```

- 채널별 독립 세션 (프로젝트 디렉토리 매핑)
- Claude Agent SDK가 Claude Code를 subprocess로 실행 (기존 인증 공유)
- tool use 승인은 Discord 버튼으로 처리 (자동승인 모드 지원)
- 스트리밍 응답을 1.5초 간격으로 Discord 메시지 edit
- 텍스트 출력 전까지 15초마다 heartbeat로 진행 상황 표시
- 마크다운 코드 블록이 메시지 분할 시에도 보존됨

## 세션 상태

| 상태 | 의미 |
|------|------|
| 🟢 online | Claude가 작업 중 |
| 🟡 waiting | tool use 승인 대기 |
| ⚪ idle | 작업 완료, 다음 입력 대기 |
| 🔴 offline | 세션 없음 |

## 보안

### 외부 공격면 제로

이 봇은 **HTTP 서버, 포트, API 엔드포인트를 일절 열지 않습니다.** 봇이 Discord 서버로 아웃바운드 WebSocket 연결을 거는 구조이기 때문에, 외부에서 이 봇에 직접 접근할 수 있는 경로 자체가 존재하지 않습니다.

```
일반 웹서버:  외부 → [포트 열고 대기] → 요청 받음    (인바운드)
이 봇:        봇 → [Discord 서버로 접속] → 이벤트 수신  (아웃바운드만)
```

### 셀프 호스팅 구조

봇은 본인의 PC/서버에서 직접 실행됩니다. 외부 서버를 거치지 않으며, Discord와 Anthropic API(본인의 Claude Code 로그인 세션 사용)를 통한 통신 외에 데이터가 외부로 나가지 않습니다.

### 접근 제어

- `ALLOWED_USER_IDS` 화이트리스트 기반 인증 — 등록되지 않은 사용자의 모든 메시지와 명령어 무시
- Discord 서버는 기본적으로 비공개 (초대 링크 없이 접근 불가)
- 분당 요청 수 제한 (rate limit)

### 실행 보호

- tool use 기본값: 파일 수정, 명령어 실행 등은 **매번 사용자 승인 필요** (Discord 버튼)
- 프로젝트 경로 `..` 순회 차단
- 파일 첨부: 실행 파일(.exe, .bat 등) 차단, 25MB 크기 제한

### 주의사항

- `.env` 파일에 봇 토큰이 포함되어 있으므로 **절대 외부에 공유하지 마세요**. 유출 시 Discord Developer Portal에서 즉시 Reset Token
- `auto-approve` 모드는 편리하지만, Claude가 의도치 않은 작업을 수행할 수 있으므로 신뢰하는 프로젝트에서만 사용을 권장합니다

## macOS 간편 실행 (백그라운드 + 메뉴바)

macOS에서 봇을 백그라운드 서비스로 실행하고, 메뉴바에서 상태를 확인할 수 있습니다.

```bash
./mac-start.sh          # 시작 (백그라운드 + 메뉴바 아이콘)
./mac-start.sh --stop   # 중지
./mac-start.sh --status # 상태 확인
./mac-start.sh --fg     # 포그라운드 모드 (디버깅용)
```

- `.env` 없이 처음 실행하면 터미널에서 대화형 설정
- 메뉴바 아이콘: 🟢 실행 중 / 🔴 중지됨 / ⚙️ 설정 필요
- 메뉴바에서: 시작/중지/재시작, 설정 편집, 로그 보기
- 크래시 시 자동 재시작, 부팅 시 자동 실행 (launchd)
- 매 시작 시 git에서 자동 업데이트

> **참고:** 이 기능은 macOS 전용입니다 (launchd, Swift 필요).

## 개발 명령어

```bash
npm run dev          # 개발 실행 (tsx)
npm run build        # 프로덕션 빌드 (tsup)
npm start            # 빌드된 파일 실행
npm test             # 테스트 (vitest)
npm run test:watch   # 테스트 watch 모드
```

## 라이선스

[MIT License](LICENSE) - 자유롭게 사용, 수정, 상업적 이용 가능. 배포 시 원본 저작권 표시 및 [출처](https://github.com/chadingTV/claudecode-discord) 명시 필요.
