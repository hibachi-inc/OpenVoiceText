#!/bin/bash
# Finder からダブルクリックすると Terminal が開いて VoiceLatte の dev 版を起動する。
# Desktop には symlink を貼って使う（mikan-chat の dev.command と同じ運用）。
# 残留プロセスが二重起動・応答なしの原因になるため、起動前に掃除してから開く。
set -u

PROJECT_DIR="/Users/kotatsu/AI-BASE/ai-dev/dev/OpenVoiceText-Pro/VoiceLatte"
DEBUG_APP="$PROJECT_DIR/src-tauri/target/debug/bundle/macos/VoiceLatte.app"
cd "$PROJECT_DIR"

# zsh で起動された場合に PATH が通らないことがあるので明示的に補う
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

echo "VoiceLatte Dev"
echo "   project: $PROJECT_DIR"
echo

# 稼働中の VoiceLatte（/Applications 版・dev 版どちらも）を gracefully に終了させる
osascript -e 'tell application "VoiceLatte" to quit' 2>/dev/null || true
sleep 2
STALE="$(pgrep -f 'VoiceLatte.app/Contents/MacOS/voicelatte' 2>/dev/null || true)"
if [ -n "$STALE" ]; then
  echo "   残留プロセスを終了します: $STALE"
  # shellcheck disable=SC2086
  kill $STALE 2>/dev/null || true
  sleep 2
  STALE="$(pgrep -f 'VoiceLatte.app/Contents/MacOS/voicelatte' 2>/dev/null || true)"
  if [ -n "$STALE" ]; then
    echo "   強制終了します: $STALE"
    # shellcheck disable=SC2086
    kill -9 $STALE 2>/dev/null || true
    sleep 1
  fi
fi

echo "   デバッグビルド中..."
# updater 署名キーなしで EXIT:1 になるが bundle 自体は出来るので、成果物で成否判定する
npm run tauri -- build --debug --bundles app >/tmp/vl-debug.log 2>&1 || true
if ! grep -q 'Bundling VoiceLatte.app' /tmp/vl-debug.log; then
  echo "   ビルド失敗。ログ: /tmp/vl-debug.log"
  tail -20 /tmp/vl-debug.log
  exit 1
fi

echo "   起動します"
open "$DEBUG_APP"
sleep 3
if pgrep -f 'target/debug/bundle/macos/VoiceLatte.app/Contents/MacOS/voicelatte' >/dev/null; then
  echo "   起動 OK"
else
  echo "   起動を確認できませんでした。ログ: /tmp/vl-debug.log"
  exit 1
fi
