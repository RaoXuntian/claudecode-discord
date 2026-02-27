<p align="center">
  <img src="icon-rounded.png" alt="Claude Code Discord Controller" width="120">
</p>

# Claude Code Discord Controller

폰에서 Claude Code를 제어하세요 — Discord를 통한 멀티머신 에이전트 허브.

## 왜 이 봇인가? — 공식 Remote Control과의 차이

Anthropic의 [Remote Control](https://code.claude.com/docs/en/remote-control)은 실행 중인 로컬 세션을 폰에서 이어보는 기능입니다. 이 봇은 그 이상 — 데몬으로 상주하며, 새 세션을 즉시 생성하고, 여러 PC를 하나의 Discord 서버에서 통합 관리하는 **멀티머신 에이전트 허브**입니다.

| | 공식 Remote Control | 이 봇 |
|---|---|---|
| **본질** | 세션 뷰어 | 세션 컨트롤러 |
| **작업 시작** | 터미널에서 `claude remote-control` 먼저 실행 필요 | Discord에 메시지만 보내면 됨 |
| **터미널 종속** | 터미널 닫으면 세션 종료 (10분 타임아웃) | 봇 데몬이 독립적으로 상주 |
| **모바일에서 새 작업** | 불가 (기존 세션만 이어감) | 메시지 보내면 바로 새 세션 |
| **동시 세션** | 머신당 1개 | 채널별 병렬 실행 |
| **멀티 PC** | 머신마다 세션 수동 전환 | Discord 서버 하나로 모든 머신 관리 |
| **팀 협업** | 1인 전용 | 팀원이 같은 채널에서 관찰/승인 가능 |
| **알림** | 앱을 직접 열어서 확인 | Discord 푸시 알림 |
| **대시보드** | 없음 | 채널 목록 = 프로젝트 현황판 |

### 멀티 PC 허브

PC별로 Discord 봇을 생성하고, 같은 서버에 초대해서 채널을 배정하면 됩니다:

```
내 Discord 서버
├── #회사맥-프론트엔드     ← 회사 Mac의 봇
├── #회사맥-백엔드        ← 회사 Mac의 봇
├── #집PC-사이드프로젝트   ← 집 PC의 봇
├── #클라우드서버-인프라   ← 클라우드 서버의 봇
```

**폰 하나로 모든 머신의 Claude Code를 제어.** 채널 목록 자체가 전체 머신/프로젝트의 실시간 상태 대시보드가 됩니다.

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
git clone https://github.com/chadingTV/claudecode-discord.git
cd claudecode-discord

# macOS / Linux
./install.sh

# Windows
./install.bat
```

### 셋업 가이드

| 플랫폼 | 가이드 |
|--------|--------|
| **macOS / Linux** | **[SETUP.kr.md](SETUP.kr.md)** — 터미널 기반 설정, 메뉴바 / 트레이 앱 |
| **Windows**    | **[SETUP-WINDOWS.kr.md](SETUP-WINDOWS.kr.md)** — GUI 설치, 시스템 트레이 + 컨트롤 패널, 바탕화면 바로가기 |

Windows 사용자: `install.bat` 하나로 모든 것이 자동 처리됩니다 — 의존성 설치, 빌드, 바탕화면 바로가기 생성, 시스템 트레이 GUI와 함께 봇 실행.

## 프로젝트 구조

```
claudecode-discord/
├── install.sh              # macOS/Linux 자동 설치 스크립트
├── install.bat             # Windows 자동 설치 스크립트
├── mac-start.sh            # macOS 백그라운드 실행 + 메뉴바
├── linux-start.sh          # Linux 백그라운드 실행 + 시스템 트레이
├── win-start.bat           # Windows 백그라운드 실행 + 시스템 트레이
├── menubar/                # macOS 메뉴바 상태 앱 (Swift)
├── tray/                   # 시스템 트레이 앱 (Linux: Python, Windows: C#)
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
├── SETUP.md                # macOS/Linux 셋업 가이드 (EN)
├── docs/                   # 번역, 부속 문서 & 스크린샷
│   ├── README.kr.md        # 한국어 README
│   ├── SETUP.kr.md         # macOS/Linux 셋업 가이드 (KR)
│   ├── SETUP-WINDOWS.md    # Windows 셋업 가이드 (EN)
│   ├── SETUP-WINDOWS.kr.md # Windows 셋업 가이드 (KR)
│   ├── TESTING.md / TESTING.kr.md  # 테스트 가이드
│   └── *.png               # 스크린샷
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

`/register` 명령어는 `BASE_PROJECT_DIR` 하위 폴더를 **자동완성 드롭다운**으로 표시합니다 — 타이핑하면 필터링되어 선택할 수 있습니다.
첫 번째 옵션 `.`은 베이스 디렉토리 자체를 등록합니다. 직접 경로를 입력해도 되며, 절대 경로도 사용 가능합니다.

> **왜 디렉토리별로 등록하나요?** Claude Code는 프로젝트 디렉토리 단위로 세션을 관리합니다 — 각 디렉토리마다 독립된 대화 기록, `CLAUDE.md` 컨텍스트, 도구 권한이 적용됩니다. Discord 채널 하나를 디렉토리 하나에 매핑하면, 각 채널이 독립적인 Claude 작업 공간이 됩니다.

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

macOS에서 봇을 백그라운드 서비스로 실행하고, 메뉴바에서 상태를 확인하며 컨트롤 패널로 관리할 수 있습니다.

<p align="center">
  <img src="mac-tray.png" alt="macOS 컨트롤 패널" width="400">
</p>

```bash
./mac-start.sh          # 시작 (백그라운드 + 메뉴바 아이콘)
./mac-start.sh --stop   # 중지
./mac-start.sh --status # 상태 확인
./mac-start.sh --fg     # 포그라운드 모드 (디버깅용)
```

봇은 **메뉴바 아이콘**과 함께 백그라운드에서 실행됩니다:

<p align="center">
  <img src="mac-tray-icon.png" alt="macOS 메뉴바 아이콘" width="300">
</p>

- **컨트롤 패널 GUI**: 메뉴바 아이콘 왼쪽 클릭으로 컨트롤 패널 열기 (오른쪽 클릭은 드롭다운 메뉴)
- **EN / KR 언어 전환** (설정 영구 저장)
- 첫 실행 시 컨트롤 패널 자동 표시; `.env` 미설정 시 설정 다이얼로그도 함께 표시
- 메뉴바 아이콘: 🟢 실행 중 / 🔴 중지됨 / ⚙️ 설정 필요
- GUI 설정 다이얼로그 — 수동 `.env` 편집 불필요:

<p align="center">
  <img src="mac-settings.png" alt="macOS 설정 다이얼로그" width="400">
</p>

- 원클릭 자동 업데이트: 코드 풀, 봇 + 메뉴바 앱 재빌드
- 크래시 시 자동 재시작, 부팅 시 자동 실행 (launchd)

> **참고:** 이 기능은 macOS 전용입니다 (launchd, Swift 필요).

## Linux 간편 실행 (백그라운드 + 시스템 트레이)

Linux에서 봇을 systemd 서비스로 실행하고, 시스템 트레이에서 상태를 확인할 수 있습니다.

```bash
./linux-start.sh          # 시작 (systemd + 트레이 아이콘)
./linux-start.sh --stop   # 중지
./linux-start.sh --status # 상태 확인
./linux-start.sh --fg     # 포그라운드 모드 (디버깅용)
```

<p align="center">
  <img src="linux-tray.png" alt="Linux 시스템 트레이" width="350">
</p>

- **EN / KR 언어 전환** (설정 영구 저장)
- `.env` 없이 처음 실행하면 GUI 설정 다이얼로그 자동 표시
- 시스템 트레이: 초록(실행 중) / 빨강(중지됨) / 주황(설정 필요), 시작/중지/설정 메뉴
- GUI 설정 다이얼로그 (GTK3) — 수동 `.env` 편집 불필요 (폴더 선택기 포함)
- 현재 버전 표시, 업데이트 확인, 원클릭 업데이트
- 크래시 시 자동 재시작, 부팅 시 자동 실행 (systemd)
- 첫 실행 시 바탕화면 바로가기 자동 생성
- 트레이는 `pip3 install pystray Pillow` 필요 (첫 실행 시 자동 설치)
- GUI 없는 서버에서도 동작 (트레이만 생략)

## Windows 간편 실행 (백그라운드 + 시스템 트레이)

Windows에서는 `install.bat`으로 모든 것이 설치되고 **바탕화면 바로가기**가 생성됩니다. 더블클릭으로 실행하세요.

<p align="center">
  <img src="windows-tray.png" alt="Windows 컨트롤 패널" width="400">
</p>

```batch
win-start.bat          &:: 시작 (백그라운드 + 트레이 + 컨트롤 패널)
win-start.bat --stop   &:: 중지
win-start.bat --status &:: 상태 확인
win-start.bat --fg     &:: 포그라운드 모드 (디버깅용)
```

봇은 **시스템 트레이 아이콘**과 함께 백그라운드에서 실행됩니다:

<p align="center">
  <img src="windows-tray-icon.png" alt="Windows 시스템 트레이 아이콘" width="300">
</p>

- **컨트롤 패널 GUI**: 트레이 아이콘 왼쪽 클릭으로 시작/중지/재시작, 설정, 로그, 자동 업데이트
- **EN / KR 언어 전환** (설정 기억됨)
- 시스템 트레이: 초록(실행 중) / 빨강(중지됨) / 주황(설정 필요)
- GUI 설정 다이얼로그 — `.env` 직접 편집 불필요:

<p align="center">
  <img src="windows-settings.png" alt="Windows 설정 다이얼로그" width="400">
</p>
- 원클릭 자동 업데이트: 코드 다운로드, 재빌드, 트레이 앱 재컴파일
- 로그온 시 자동 시작 (Windows 레지스트리)
- `install.bat`으로 바탕화면 바로가기 자동 생성

> 전체 Windows 가이드는 **[SETUP-WINDOWS.kr.md](SETUP-WINDOWS.kr.md)**를 참고하세요.

## 개발 명령어

```bash
npm run dev          # 개발 실행 (tsx)
npm run build        # 프로덕션 빌드 (tsup)
npm start            # 빌드된 파일 실행
npm test             # 테스트 (vitest)
npm run test:watch   # 테스트 watch 모드
```

## 라이선스

[MIT License](../LICENSE) - 자유롭게 사용, 수정, 상업적 이용 가능. 배포 시 원본 저작권 표시 및 [출처](https://github.com/chadingTV/claudecode-discord) 명시 필요.

---

이 프로젝트가 유용하셨다면 ⭐ 를 눌러주세요 — 더 많은 사람들이 발견할 수 있게 됩니다!
