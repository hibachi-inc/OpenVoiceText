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
  const heightAnimRef = useRef(0);
  // 出現/退場トランジション用の transient クラス
  const [entering, setEntering] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const prevPhaseRef = useRef<HudState["phase"]>("idle");
  const hasChoice = state.phase === "done" && state.choice != null;
  // 0: 元のまま、1: AI整形版。初期フォーカスは整形版。
  const [selected, setSelected] = useState(1);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  // 録音開始時に一度だけ記録するHUDの下辺(論理座標)。以後はこの下辺を固定して上へ伸びる。
  const hudBottomRef = useRef<number | null>(null);
  // 目標高さへ約240msでイージングしながらリサイズし、下辺固定のまま滑らかに伸縮させる
  const smoothResizeTo = (target: number, bottom: number | null) => {
    if (bottom === null) return;
    if (target === hudHeightRef.current) return;
    cancelAnimationFrame(heightAnimRef.current);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      hudHeightRef.current = target;
      void invoke("hud_resize", { height: target, bottom }).catch(() => undefined);
      return;
    }
    const from = hudHeightRef.current;
    const delta = target - from;
    const duration = 240;
    const start = performance.now();
    const step = (now: number) => {
      const k = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - k, 3);
      const height = from + delta * eased;
      hudHeightRef.current = height;
      void invoke("hud_resize", { height, bottom }).catch(() => undefined);
      if (k < 1) heightAnimRef.current = requestAnimationFrame(step);
      else hudHeightRef.current = target;
    };
    heightAnimRef.current = requestAnimationFrame(step);
  };
  useEffect(() => () => cancelAnimationFrame(heightAnimRef.current), []);
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
      // 前回拡大したままのときだけ実ウィンドウを 64 に戻す(退場フェードと同時に滑らかに縮小)
      if (hudHeightRef.current !== 64) {
        void (async () => {
          const hudWindow = getCurrentWindow();
          const scale = await hudWindow.scaleFactor().catch(() => 1);
          const position = await hudWindow.outerPosition().catch(() => undefined);
          const size = await hudWindow.outerSize().catch(() => undefined);
          if (position && size) {
            const bottom = position.y / scale + size.height / scale;
            smoothResizeTo(64, bottom);
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
  // 退場時に選択肢が即消えすると点滅に見えるため、直前の内容を少し残してフェードさせる
  const lastChoiceRef = useRef(state.choice);
  const [choiceLeaving, setChoiceLeaving] = useState(false);
  useEffect(() => {
    if (state.choice) lastChoiceRef.current = state.choice;
  }, [state.choice]);
  useEffect(() => {
    if (hasChoice) {
      setChoiceLeaving(false);
      return;
    }
    if (!lastChoiceRef.current) return;
    setChoiceLeaving(true);
    const timer = window.setTimeout(() => {
      setChoiceLeaving(false);
      lastChoiceRef.current = undefined;
    }, 220);
    return () => window.clearTimeout(timer);
  }, [hasChoice]);
  const visibleChoice = state.choice ?? (choiceLeaving ? lastChoiceRef.current : undefined);
  const showChoice = hasChoice || (choiceLeaving && visibleChoice != null);
  // 出現(idle→active)/退場(active→idle)でトランジション用クラスを一時付与する
  // leavingはタイマーで外さない。外すと非表示直前に再表示されて点滅するため、
  // 次のidle→activeまで維持する(窓自体はhideされるので見た目は変わらない)。
  useEffect(() => {
    const prev = prevPhaseRef.current;
    const cur = state.phase;
    prevPhaseRef.current = cur;
    if (prev === "idle" && cur !== "idle") {
      setLeaving(false);
      setEntering(true);
      const timer = window.setTimeout(() => setEntering(false), 280);
      return () => window.clearTimeout(timer);
    }
    if (prev !== "idle" && cur === "idle") {
      setEntering(false);
      setLeaving(true);
      // 本体側のhideが隠し窓タイマー遅延で遅れても透明なままにする保険。
      // 見えない窓がクリックを奪うのを防ぐ。phase変化で破棄される。
      const backup = window.setTimeout(() => {
        void getCurrentWindow().hide().catch(() => undefined);
      }, 400);
      return () => window.clearTimeout(backup);
    }
  }, [state.phase]);
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
    // AI変換完了で選択肢が増える瞬間も含め、高さ変化は下辺固定のまま滑らかに伸縮させる
    smoothResizeTo(logicalHeight, hudBottomRef.current);
  }, [state.transcript, state.phase, state.spaceHint, state.choice]);
  const deferred = state.captureMode === "deferred";
  const placeholder = !state.transcript && state.phase === "listening";
  const displayText = state.transcript || (placeholder ? t(deferred ? "hud.deferredPrompt" : "hud.prompt") : state.message) || t("hud.prompt");
  return <main className={`hud ${state.phase}${deferred ? " deferred" : ""}${showChoice ? " tall" : ""}${state.phase === "processing" && state.refining ? " ai" : ""}${entering ? " hud-enter" : ""}${leaving ? " hud-leaving" : ""}`}>
    <div className="hud-drag-layer" data-tauri-drag-region />
    {showChoice && visibleChoice && <div className={"hud-choice" + (!hasChoice ? " hud-choice-leaving" : "")} ref={choiceBoxRef}>
      <div className="hud-choice-title">{t("record.choose")}</div>
      <div className="choice-options">
        <button type="button" className={"choice-option" + (selected === 0 ? " focused" : "")} onClick={() => confirmChoice(0)} onMouseEnter={() => setSelected(0)}><span>{t("hud.useRaw")}</span><span>{visibleChoice.raw}</span></button>
        <button type="button" className={"choice-option primary" + (selected === 1 ? " focused" : "")} onClick={() => confirmChoice(1)} onMouseEnter={() => setSelected(1)}><span>{t("hud.useRefined")}</span><span>{visibleChoice.refined}</span></button>
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
