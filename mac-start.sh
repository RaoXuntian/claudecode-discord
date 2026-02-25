#!/bin/bash
# Claude Discord Bot - Auto-update & Start Script
# 사용법:
#   ./mac-start.sh          → 백그라운드 실행 (launchd 등록)
#   ./mac-start.sh --fg     → 포그라운드 실행 (디버깅용)
#   ./mac-start.sh --stop   → 중지
#   ./mac-start.sh --status → 상태 확인

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"

# .env 파일 없으면 초기 설정
if [ ! -f "$ENV_FILE" ]; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  Claude Discord Bot - 초기 설정"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    read -p "Discord Bot Token: " BOT_TOKEN
    if [ -z "$BOT_TOKEN" ]; then
        echo "❌ Bot Token은 필수입니다"
        exit 1
    fi

    read -p "Discord Guild(서버) ID: " GUILD_ID
    if [ -z "$GUILD_ID" ]; then
        echo "❌ Guild ID는 필수입니다"
        exit 1
    fi

    read -p "허용할 Discord User ID (여러 명이면 쉼표 구분): " USER_IDS
    if [ -z "$USER_IDS" ]; then
        echo "❌ User ID는 필수입니다"
        exit 1
    fi

    read -p "프로젝트 기본 디렉토리 [$(pwd)]: " PROJECT_DIR
    PROJECT_DIR="${PROJECT_DIR:-$(pwd)}"

    read -p "분당 요청 제한 [10]: " RATE_LIMIT
    RATE_LIMIT="${RATE_LIMIT:-10}"

    echo ""
    echo "Max 플랜 사용자는 비용이 표시되지 않으므로 false 권장"
    read -p "비용 표시 (true/false) [true]: " SHOW_COST
    SHOW_COST="${SHOW_COST:-true}"

    cat > "$ENV_FILE" << EOF
DISCORD_BOT_TOKEN=$BOT_TOKEN
DISCORD_GUILD_ID=$GUILD_ID
ALLOWED_USER_IDS=$USER_IDS
BASE_PROJECT_DIR=$PROJECT_DIR
RATE_LIMIT_PER_MINUTE=$RATE_LIMIT
SHOW_COST=$SHOW_COST
EOF

    echo ""
    echo "✅ .env 파일이 생성되었습니다"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
fi

PLIST_NAME="com.claude-discord.plist"
PLIST_SRC="$SCRIPT_DIR/$PLIST_NAME"
PLIST_DST="$HOME/Library/LaunchAgents/$PLIST_NAME"
LABEL="com.claude-discord"
MENUBAR="$SCRIPT_DIR/menubar/ClaudeBotMenu"

# --stop: 중지
if [ "$1" = "--stop" ]; then
    if launchctl list | grep -q "$LABEL"; then
        launchctl unload "$PLIST_DST" 2>/dev/null
        echo "🔴 봇 중지됨"
    else
        echo "봇이 실행 중이 아닙니다"
    fi
    # 메뉴바 앱도 종료
    pkill -f "ClaudeBotMenu" 2>/dev/null
    exit 0
fi

# --status: 상태 확인
if [ "$1" = "--status" ]; then
    if launchctl list | grep -q "$LABEL"; then
        PID=$(launchctl list | grep "$LABEL" | awk '{print $1}')
        echo "🟢 봇 실행 중 (PID: $PID)"
    else
        echo "🔴 봇 중지됨"
    fi
    exit 0
fi

# --fg: 포그라운드 실행 (launchd 없이 직접 실행)
if [ "$1" = "--fg" ]; then
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
    cd "$SCRIPT_DIR"

    echo "[claude-bot] Git 업데이트 확인 중..."
    git fetch origin main 2>/dev/null
    LOCAL=$(git rev-parse HEAD 2>/dev/null)
    REMOTE=$(git rev-parse origin/main 2>/dev/null)

    if [ -n "$LOCAL" ] && [ -n "$REMOTE" ] && [ "$LOCAL" != "$REMOTE" ]; then
        echo "[claude-bot] 업데이트 발견! 자동 업데이트 중..."
        git pull origin main
        npm install --production
        npm run build
        echo "[claude-bot] 업데이트 완료 ($(git log --oneline -1))"
    else
        echo "[claude-bot] 최신 버전"
    fi

    if [ ! -d "dist" ]; then
        echo "[claude-bot] 빌드 파일 없음, 빌드 중..."
        npm run build
    fi

    echo "[claude-bot] 봇 시작 (포그라운드)..."
    exec node dist/index.js
fi

# 기본: 백그라운드 실행 (launchd 등록)
if [ ! -f "$PLIST_SRC" ]; then
    echo "❌ $PLIST_NAME 파일을 찾을 수 없습니다"
    exit 1
fi

# 이미 실행 중이면 종료 후 재시작
if launchctl list | grep -q "$LABEL"; then
    echo "🔄 기존 봇 종료 중..."
    launchctl unload "$PLIST_DST" 2>/dev/null
    sleep 1
fi

# 메뉴바 앱 컴파일 (바이너리 없으면)
if [ ! -f "$MENUBAR" ] && [ -f "$SCRIPT_DIR/menubar/ClaudeBotMenu.swift" ]; then
    echo "🔨 메뉴바 앱 빌드 중..."
    swiftc -o "$MENUBAR" "$SCRIPT_DIR/menubar/ClaudeBotMenu.swift" -framework Cocoa 2>/dev/null
fi

# plist 복사 & 등록
cp "$PLIST_SRC" "$PLIST_DST"
launchctl load "$PLIST_DST"

# 메뉴바 앱 실행
if [ -f "$MENUBAR" ]; then
    pkill -f "ClaudeBotMenu" 2>/dev/null
    nohup "$MENUBAR" > /dev/null 2>&1 &
    echo "🟢 봇이 백그라운드에서 시작되었습니다 (메뉴바 표시)"
else
    echo "🟢 봇이 백그라운드에서 시작되었습니다"
fi
echo "   중지: ./mac-start.sh --stop"
echo "   상태: ./mac-start.sh --status"
echo "   로그: tail -f bot.log"
