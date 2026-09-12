import { useEffect, useMemo, useRef, useState } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createTranslator, resolveUiLanguage } from "../../i18n";
import { phaseLabel } from "../../app/formatters";
import type { HudState } from "../../app/types";

const systemUiLanguage = resolveUiLanguage("system");

export function Hud() {
  const [state, setState] = useState<HudState>({ phase: "preparing", transcript: "", raw: "", level: 0, engine: "", captureMode: "live", uiLanguage: systemUiLanguage });
  const t = useMemo(() => createTranslator(state.uiLanguage ?? systemUiLanguage), [state.uiLanguage]);
  const transcriptViewRef = useRef<HTMLElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  const choiceBoxRef = useRef<HTMLDivElement>(null);
  const hudHeightRef = useRef(64);
  const hasChoice = state.phase === "done" && state.choice != null;
  // 0: 元のまま、1: AI整形版。初期フォーカスは整形版。
  const [selected, setSelected] = useState(1);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  // 録音開始時に一度だけ記録するHUDの下辺(論理座標)。以後はこの下辺を固定して上へ伸びる。
  const hudBottomRef = useRef<number | null>(null);
  useEffect(() => {
    const hudWindow = getCurrentWindow();
    void (async () => {
      await hudWindow.setBackgroundColor([0, 0, 0, 0]);
    })();
    // ドラッグで移動したときに下辺を更新し、そこを基準に上へ伸びるようにする
    let unlistenMoved: (() => void) | undefined;
    void hudWindow.onMoved(({ payload }) => {
      void (async () => {
        const scale = await hudWindow.scaleFactor().catch(() => 1);
        const size = await hudWindow.outerSize().catch(() => undefined);
        if (size) {
          hudBottomRef.current = payload.y / scale + size.height / scale;
        }
      })();
    }).then((fn) => { unlistenMoved = fn; });
    let unlisten: (() => void) | undefined;
    void listen<HudState>("recording-state", (event) => setState(event.payload)).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); unlistenMoved?.(); };
  }, []);
  useEffect(() => {
    const view = transcriptViewRef.current;
    if (!view) return;
    if (!state.transcript) view.scrollLeft = 0;
  }, [state.transcript]);
  // 録音開始時(またはリセット時)に下辺を記録する
  useEffect(() => {
    if (state.phase === "idle") {
      hudBottomRef.current = null;
      // 前回拡大したままのときだけ実ウィンドウを 64 に戻す
      if (hudHeightRef.current !== 64) {
        hudHeightRef.current = 64;
        void (async () => {
          const hudWindow = getCurrentWindow();
          const scale = await hudWindow.scaleFactor().catch(() => 1);
          const position = await hudWindow.outerPosition().catch(() => undefined);
          const size = await hudWindow.outerSize().catch(() => undefined);
          if (position && size) {
            const bottom = position.y / scale + size.height / scale;
            await invoke("hud_resize", { height: 64, bottom }).catch(() => undefined);
          }
        })();
      }
      return;
    }
    if (hudBottomRef.current !== null) return;
    void (async () => {
      const hudWindow = getCurrentWindow();
      const scale = await hudWindow.scaleFactor().catch(() => 1);
      const position = await hudWindow.outerPosition().catch(() => undefined);
      const size = await hudWindow.outerSize().catch(() => undefined);
      if (position && size) {
        hudBottomRef.current = position.y / scale + size.height / scale;
      }
    })();
  }, [state.phase]);
  // 新しい選択肢が来たらフォーカスを整形版に戻す
  useEffect(() => {
    setSelected(1);
  }, [state.choice?.raw, state.choice?.refined]);
  // 選択肢表示中だけキー操作を受け付ける
  useEffect(() => {
    if (!hasChoice) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowUp" || event.key === "w" || event.key === "W" || event.key === "a" || event.key === "A") {
        event.preventDefault();
        setSelected(0);
      } else if (event.key === "ArrowDown" || event.key === "s" || event.key === "S" || event.key === "d" || event.key === "D") {
        event.preventDefault();
        setSelected(1);
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        confirmChoice(selectedRef.current);
      } else if (event.key === "Escape") {
        event.preventDefault();
        void emitTo("main", "hud-choose", { which: "cancel" }).catch(() => undefined);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hasChoice]);
  useEffect(() => {
    const copy = copyRef.current;
    const view = transcriptViewRef.current;
    if (!copy || !view) return;
    // 折り返し行数が変わったときだけリサイズし、下辺を固定して上方向へ伸ばす
    // 判定は本文の自然な高さ(view.scrollHeightはmax-heightの影響を受けない)+ラベル・余白で、
    // 表示上の高さ制限から独立させる
    const label = copy.querySelector("small") as HTMLElement | null;
    const chrome = 20 + (label?.offsetHeight ?? 14);
    // 行増減でギチギチにならないよう固定余白を足す（初回表示の余裕を維持）。
    const SLACK = 12;
    const capped = view.scrollHeight + chrome > 320;
    view.classList.toggle("capped", capped);
    // 上限時は本文の最大高さをウィンドウ内に収まる値に合わせる
    if (capped) view.style.maxHeight = `${320 - chrome - SLACK}px`;
    else view.style.removeProperty("max-height");
    // 上限到達後はテキスト領域だけを末尾へ自動スクロールさせる
    if (capped) view.scrollTop = view.scrollHeight;
    const barHeight = Math.max(64, Math.min(view.scrollHeight + chrome + SLACK, 320));
    // 選択肢表示中はその分だけ上へ伸ばす（同一ウィンドウなので追従ズレなし）
    let logicalHeight = barHeight;
    const box = choiceBoxRef.current;
    if (hasChoice && box) {
      logicalHeight = Math.min(barHeight + Math.min(box.scrollHeight + 10, 480), 560);
    }
    if (logicalHeight === hudHeightRef.current) return;
    void (async () => {
      const bottom = hudBottomRef.current;
      if (bottom === null) return;
      await invoke("hud_resize", { height: logicalHeight, bottom }).catch(() => undefined);
      hudHeightRef.current = logicalHeight;
    })();
  }, [state.transcript, state.phase, state.spaceHint, state.choice]);
  const deferred = state.captureMode === "deferred";
  const placeholder = !state.transcript && state.phase === "listening";
  const displayText = state.transcript || (placeholder ? t(deferred ? "hud.deferredPrompt" : "hud.prompt") : state.message) || t("hud.prompt");
  return <main className={`hud ${state.phase}${deferred ? " deferred" : ""}${hasChoice ? " tall" : ""}${state.phase === "processing" && state.refining ? " ai" : ""}`}>
    <div className="hud-drag-layer" data-tauri-drag-region />
    {hasChoice && state.choice && <div className="hud-choice" ref={choiceBoxRef}>
      <div className="hud-choice-title">{t("record.choose")}</div>
      <div className="choice-options">
        <button type="button" className={"choice-option" + (selected === 0 ? " focused" : "")} onClick={() => confirmChoice(0)} onMouseEnter={() => setSelected(0)}><span>{t("hud.useRaw")}</span><span>{state.choice.raw}</span></button>
        <button type="button" className={"choice-option primary" + (selected === 1 ? " focused" : "")} onClick={() => confirmChoice(1)} onMouseEnter={() => setSelected(1)}><span>{t("hud.useRefined")}</span><span>{state.choice.refined}</span></button>
      </div>
    </div>}
    <div className="hud-orb"><span className="hud-pulse" /><span className="hud-mic">●</span></div>
    <div className="hud-copy" ref={copyRef}><small>{phaseLabel(state.phase, t, deferred, state.refining)}{state.phase === "listening" && state.spaceHint ? ` ・ ${t("hud.spaceHint")}` : ""}{state.phase === "processing" && (state.elapsed ?? 0) > 0 ? ` · ${state.elapsed}s` : ""}</small><b ref={transcriptViewRef} className={placeholder ? "placeholder" : undefined}>{displayText}</b></div>
    <div className="hud-meter" aria-label={t("hud.audioLevel")}>{Array.from({ length: 7 }, (_, i) => <i key={i} className={i / 7 < state.level ? "lit" : ""} />)}</div>
    {(state.phase === "listening" || state.phase === "preparing") && <Button variant="ghost" className="hud-stop h-9 rounded-none" onClick={() => void emitTo("main", "hud-stop")}><Square />{t("hud.stop")}</Button>}
  </main>;
}

function confirmChoice(index: number) {
  void emitTo("main", "hud-choose", { which: index === 0 ? "raw" : "refined" }).catch(() => undefined);
}
