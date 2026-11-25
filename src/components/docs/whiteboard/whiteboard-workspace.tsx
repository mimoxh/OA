"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadWhiteboardFile } from "@/lib/docs/whiteboard/canvas";
import { parseWhiteboard, type WhiteboardElement, type WhiteboardPayload, type WhiteboardScene } from "@/lib/docs/whiteboard/content";
import { randomId } from "@/lib/client-id";
import { WhiteboardCanvas } from "./whiteboard-canvas";

export type WhiteboardWorkspaceHandle = { flush: () => Promise<boolean> };

type Draft = { key: string; scene: WhiteboardScene | null };
type SaveStatus = "saved" | "dirty" | "saving" | "error" | "conflict";

const labels: Record<SaveStatus, string> = {
  saved: "已保存",
  dirty: "待保存",
  saving: "正在保存…",
  error: "保存失败",
  conflict: "版本冲突",
};

function loadDraft(payload: WhiteboardPayload): Draft | null {
  if (!payload.canWrite) return null;
  try {
    const sessionKey = "oa:whiteboard:tab";
    let tabId = sessionStorage.getItem(sessionKey);
    if (!tabId) {
      tabId = randomId();
      sessionStorage.setItem(sessionKey, tabId);
    }
    const key = `oa:whiteboard:${payload.userId}:${payload.id}:${tabId}`;
    const stored = localStorage.getItem(key);
    const scene = stored ? parseWhiteboard(stored) : null;
    if (scene && JSON.stringify(scene.elements) === JSON.stringify(payload.scene.elements)) {
      localStorage.removeItem(key);
      return { key, scene: null };
    }
    return { key, scene };
  } catch {
    return null;
  }
}

type LoadResult = { url: string; error: string } | { url: string; payload: WhiteboardPayload; draft: Draft | null };

export function WhiteboardWorkspace({
  boardId, title, compact, readOnly, refresh = 0, saveRef,
}: {
  boardId: string;
  title?: string;
  compact?: boolean;
  readOnly?: boolean;
  refresh?: number;
  saveRef?: Ref<WhiteboardWorkspaceHandle>;
}) {
  const [result, setResult] = useState<LoadResult | null>(null);
  const [attempt, setAttempt] = useState(0);
  const url = `/api/docs/whiteboards/${encodeURIComponent(boardId)}`;
  const key = `${url}:${refresh}:${attempt}:${readOnly ?? false}`;

  useEffect(() => {
    const abort = new AbortController();
    fetch(url, { cache: "no-store", signal: abort.signal })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "白板无法打开");
        const payload = body as WhiteboardPayload;
        if (!abort.signal.aborted) setResult({ url: key, payload, draft: readOnly ? null : loadDraft(payload) });
      })
      .catch((error: unknown) => {
        if (!abort.signal.aborted) setResult({ url: key, error: error instanceof Error ? error.message : "白板加载失败" });
      });
    return () => abort.abort();
  }, [key, url, readOnly]);

  if (!result || result.url !== key) {
    return <div className="flex min-h-48 items-center justify-center gap-2 rounded-xl border border-line text-sm text-ink-3">
      <Loader2 className="size-4 animate-spin" />加载白板…
    </div>;
  }

  if ("error" in result) {
    return <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-xl border border-line text-sm text-ink-2">
      <p>{result.error}</p>
      <Button onClick={() => setAttempt((n) => n + 1)}>重试</Button>
    </div>;
  }

  return (
    <WhiteboardSession
      key={key}
      payload={result.payload}
      title={title ?? result.payload.title}
      draft={result.draft}
      canWrite={result.payload.canWrite && !readOnly}
      compact={compact}
      url={url}
      saveRef={saveRef}
      reload={() => setAttempt((n) => n + 1)}
    />
  );
}

function WhiteboardSession({
  payload, title, draft, canWrite, compact, url, saveRef, reload,
}: {
  payload: WhiteboardPayload;
  title: string;
  draft: Draft | null;
  canWrite: boolean;
  compact?: boolean;
  url: string;
  saveRef?: Ref<WhiteboardWorkspaceHandle>;
  reload: () => void;
}) {
  const initial = draft?.scene ?? payload.scene;
  const conflict = !!draft?.scene && initial.revision !== payload.scene.revision;
  const [elements, setElements] = useState(initial.elements);
  const [status, setStatus] = useState<SaveStatus>(conflict ? "conflict" : draft?.scene ? "dirty" : "saved");
  const [error, setError] = useState("");
  const sync = useRef({
    revision: initial.revision,
    current: initial.elements,
    confirmed: payload.scene.elements,
    conflict,
    pending: null as Promise<boolean> | null,
  });
  const draftKey = draft?.key;

  const rememberDraft = useCallback(() => {
    if (!draftKey) return;
    const state = sync.current;
    try {
      if (state.current === state.confirmed) {
        localStorage.removeItem(draftKey);
      } else {
        localStorage.setItem(draftKey, JSON.stringify({
          version: 1, revision: state.revision, elements: state.current,
        } satisfies WhiteboardScene));
      }
    } catch {
      // Browser storage can be unavailable. The current canvas still holds the draft.
    }
  }, [draftKey]);

  const flush = useCallback(async () => {
    const state = sync.current;
    if (!canWrite || state.conflict) return false;
    if (state.pending) return state.pending;
    if (state.current === state.confirmed) return true;
    state.pending = (async () => {
      while (state.current !== state.confirmed) {
        const items = state.current;
        setStatus("saving");
        try {
          const res = await fetch(url, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ expectedRevision: state.revision, elements: items }),
            signal: AbortSignal.timeout(15_000),
          });
          const data = await res.json();
          if (res.status === 409) {
            state.conflict = true;
            setStatus("conflict");
            return false;
          }
          if (!res.ok) throw new Error(data.error || "保存失败，请重试");
          state.revision = data.revision;
          state.confirmed = items;
          rememberDraft();
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "保存失败，请重试");
          setStatus("error");
          return false;
        }
      }
      setStatus("saved");
      return true;
    })().finally(() => { state.pending = null; });
    return state.pending;
  }, [canWrite, rememberDraft, url]);

  useImperativeHandle(saveRef, () => ({ flush }), [flush]);

  useEffect(() => {
    if (status !== "dirty") return;
    const timeout = setTimeout(() => { void flush(); }, 550);
    return () => clearTimeout(timeout);
  }, [elements, flush, status]);

  useEffect(() => {
    if (!canWrite) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (sync.current.current === sync.current.confirmed) return;
      event.preventDefault();
      event.returnValue = true;
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [canWrite]);

  const edit = (items: WhiteboardElement[]) => {
    sync.current.current = items;
    setElements(items);
    setStatus("dirty");
    rememberDraft();
  };

  const downloadDraft = () => downloadWhiteboardFile(
    new Blob([JSON.stringify({ version: 1, revision: sync.current.revision, elements }, null, 2)], { type: "application/json" }),
    `${title || "白板"}-草稿.json`,
  );

  const loadLatest = () => {
    if (!window.confirm("载入最新白板会清除当前草稿。是否继续？")) return;
    sync.current.current = sync.current.confirmed;
    rememberDraft();
    reload();
  };

  return (
    <div className="space-y-2">
      <div className="flex min-h-6 flex-wrap items-center justify-end gap-2 text-xs text-ink-3" role="status">
        {status === "conflict" ? (
          <>
            <span className="text-amber-700">白板已在其他位置更新，当前草稿可下载。</span>
            <Button size="sm" onClick={downloadDraft}><Download className="size-3.5" />下载草稿</Button>
            <Button size="sm" onClick={loadLatest}>载入最新版本</Button>
          </>
        ) : status === "error" ? (
          <>
            <span className="text-rose-700">{error}</span>
            <Button size="sm" onClick={downloadDraft}>下载草稿</Button>
            <Button size="sm" onClick={() => { void flush(); }}>重试保存</Button>
          </>
        ) : canWrite ? labels[status] : "只读"}
      </div>
      <WhiteboardCanvas
        boardId={payload.id}
        title={title}
        elements={elements}
        references={payload.references}
        onChange={canWrite && status !== "conflict" ? edit : undefined}
        compact={compact}
      />
    </div>
  );
}
