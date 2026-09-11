#!/bin/bash
# Finder からダブルクリックすると Terminal が開いて VoiceLatte の dev 版を起動する。
# Desktop には symlink を貼って使う。
#
# 注意: dev版 (Tauri, 実体 voicelatte) と製品版はバンドルID・アプリ名が同一
# (com.hibachi.voicelatte / VoiceLatte)。製品版が残留していると open が
# 製品版を再利用して修正が反映されないため、dev版を確実に落としてから開く。
set -u

# 配置場所に依存しないよう、 symlink 解決つきで自身の場所を特定する。
SOURCE="$0"
while [ -L "$SOURCE" ]; do
  DIR="$(cd "$(dirname "$SOURCE")" && pwd)"
  LINK="$(readlink "$SOURCE")"
  case "$LINK" in
    /*) SOURCE="$LINK" ;;
    *) SOURCE="$DIR/$LINK" ;;
  esac
done
PROJECT_DIR="$(cd "$(dirname "$SOURCE")" && pwd)"
DEBUG_APP="$PROJECT_DIR/src-tauri/target/debug/bundle/macos/VoiceLatte.app"
DEBUG_BIN="$DEBUG_APP/Contents/MacOS/voicelatte"
cd "$PROJECT_DIR" || exit 1

# zsh で起動された場合に PATH が通らないことがあるので明示的に補う
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

echo "VoiceLatte Dev"
echo "   project: $PROJECT_DIR"
echo

# --- 1. 残留プロセスの掃除 ---
# dev版とサイドカーを対象にする。/Applications の製品版は殺さない。
stale_pids() {
  for pid in $(pgrep -f 'MacOS/voicelatte|voicelatte-speech' 2>/dev/null || true); do
    case "$(ps -o command= -p "$pid" 2>/dev/null || true)" in
      *"/Applications/"*) continue ;;
      *) echo "$pid" ;;
    esac
  done
}

# /Applications の製品版が動いていたら手を出さず中断する
# （バンドルIDが同一のため、残っていると open が製品版を再利用してしまう）
for pid in $(pgrep -f 'MacOS/voicelatte' 2>/dev/null || true); do
  case "$(ps -o command= -p "$pid" 2>/dev/null || true)" in
    *"/Applications/"*)
      echo "   /Applications の製品版が起動中です。先に終了してください (pid=$pid)"
      exit 1
      ;;
  esac
done

STALE="$(stale_pids)"
if [ -n "$STALE" ]; then
  echo "   残留プロセスを終了します:"
  echo "$STALE" | while read -r pid; do
    [ -n "$pid" ] && ps -o pid=,command= -p "$pid" 2>/dev/null || true
  done
  # shellcheck disable=SC2086
  kill $STALE 2>/dev/null || true
fi

i=0
while [ $i -lt 5 ]; do
  [ -z "$(stale_pids)" ] && break
  sleep 2
  i=$((i + 1))
done

STALE="$(stale_pids)"
if [ -n "$STALE" ]; then
  echo "   強制終了します: $STALE"
  # shellcheck disable=SC2086
  kill -9 $STALE 2>/dev/null || true
  sleep 1
fi
STALE="$(stale_pids)"
if [ -n "$STALE" ]; then
  echo "   残留プロセスが落とせませんでした: $STALE"
  exit 1
fi
echo "   プロセス掃除 OK（dev版・サイドカーいずれもなし）"

# --- 2. デバッグビルド ---
echo "   デバッグビルド中..."
# updater 署名キーなしで EXIT:1 になるが bundle 自体は出来るので、成果物で成否判定する
npm run tauri -- build --debug --bundles app >/tmp/vl-debug.log 2>&1 || true
if ! grep -q 'Bundling VoiceLatte.app' /tmp/vl-debug.log; then
  echo "   ビルド失敗。ログ: /tmp/vl-debug.log"
  tail -20 /tmp/vl-debug.log
  exit 1
fi
echo "   ビルド OK: $(stat -f '%Sm' -t '%m/%d %H:%M' "$DEBUG_BIN")"

# --- 3. 起動 ---
echo "   起動します"
open "$DEBUG_APP"

# 実体パスがDEBUG_BINと一致し、起動経過が120秒未満のプロセスを待つ（古い実体の再利用を検出する）
elapsed_of() {
  ps -o etime= -p "$1" 2>/dev/null | awk -F'[-:]' '{s=0; for(i=1;i<=NF;i++) s=s*60+$i; print s}'
}
OK=""
i=0
while [ $i -lt 20 ]; do
  sleep 1
  for pid in $(pgrep -f 'target/debug/bundle/macos/VoiceLatte.app/Contents/MacOS/voicelatte' 2>/dev/null || true); do
    case "$(ps -o command= -p "$pid" 2>/dev/null || true)" in
      "$DEBUG_BIN"*)
        ELAPSED="$(elapsed_of "$pid")"
        if [ -n "$ELAPSED" ] && [ "$ELAPSED" -lt 120 ]; then
          OK="$pid"
          break 2
        fi
        ;;
    esac
  done
  i=$((i + 1))
done

if [ -n "$OK" ]; then
  echo "   起動 OK (pid=$OK, 実体=$DEBUG_BIN)"
else
  echo "   起動を確認できませんでした。ログ: /tmp/vl-debug.log"
  pgrep -fl 'voicelatte|VoiceLatte' 2>/dev/null || true
  exit 1
fi
