"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AudioLines,
  ChevronDown,
  Mic,
  MicOff,
  Share2,
  Sparkles,
  StopCircle,
  Volume2,
} from "lucide-react";
import { DocumentEditor, type DocumentEditorHandle } from "./DocumentEditor";
import { WorkspaceRail } from "./WorkspaceRail";
import {
  useRealtimeVoice,
  type DelegationBatchToolInput,
  type PatchToolInput,
} from "@/hooks/useRealtimeVoice";
import type {
  CanvasArtifact,
  DelegatedTask,
  DelegatedTaskResult,
  DocumentPatchOperation,
  PatchProposal,
  ProactiveMode,
  SelectionContext,
  StructuredDocument,
  TranscriptEntry,
  VoiceStatus,
  WorkspaceTab,
} from "@/lib/workspace-types";

const EMPTY_DOCUMENT: StructuredDocument = {
  schemaVersion: "1.0",
  revision: 1,
  title: "语音协作工作台 PRD",
  plainText: "",
  blocks: [],
  selection: { from: 1, to: 1, text: "", blockIds: [], revision: 1 },
};

const STARTER_ARTIFACTS: CanvasArtifact[] = [
  {
    id: "starter-flow",
    type: "mermaid",
    title: "语音原生的编辑闭环",
    source: "把核心用户旅程画成流程图",
    body: `flowchart TD
  read["读取文档与选区"] --> intent["理解口述意图"]
  intent --> proposal["生成可见提案"]
  proposal --> decision{"用户决定"}
  decision -->|接受| apply["应用并保留撤销"]
  decision -->|拒绝或调整| intent`,
  },
];

function createId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function charactersIn(text: string) {
  return Array.from(text.replace(/\s/g, "")).length;
}

function hasDependencyCycle(tasks: DelegationBatchToolInput["tasks"]) {
  const dependencies = new Map(tasks.map((task) => [task.taskKey, task.dependsOn]));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(taskKey: string): boolean {
    if (visiting.has(taskKey)) return true;
    if (visited.has(taskKey)) return false;
    visiting.add(taskKey);
    for (const dependency of dependencies.get(taskKey) ?? []) {
      if (visit(dependency)) return true;
    }
    visiting.delete(taskKey);
    visited.add(taskKey);
    return false;
  }

  return tasks.some((task) => visit(task.taskKey));
}

function voiceLabel(status: VoiceStatus) {
  switch (status) {
    case "connecting": return "正在连接";
    case "listening": return "正在聆听";
    case "muted": return "语音已暂停";
    case "thinking": return "正在思考";
    case "speaking": return "正在回复";
    case "error": return "连接异常";
    default: return "开启语音";
  }
}

export function VoiceWorkspace() {
  const editorRef = useRef<DocumentEditorHandle>(null);
  const proactiveTimerRef = useRef<number | null>(null);
  const taskAbortControllersRef = useRef(new Map<string, AbortController>());
  const lastProactiveRevisionRef = useRef(1);
  const lastProactiveAtRef = useRef(0);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("canvas");
  const [revision, setRevision] = useState(1);
  const [documentState, setDocumentState] = useState<StructuredDocument>(EMPTY_DOCUMENT);
  const [selection, setSelection] = useState<SelectionContext>({
    from: 1,
    to: 1,
    text: "",
    blockIds: [],
    revision: 1,
  });
  const [patch, setPatch] = useState<PatchProposal | null>(null);
  const [artifacts, setArtifacts] = useState<CanvasArtifact[]>(STARTER_ARTIFACTS);
  const [tasks, setTasks] = useState<DelegatedTask[]>([]);
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [proactiveMode, setProactiveMode] = useState<ProactiveMode>("off");

  useEffect(() => () => {
    taskAbortControllersRef.current.forEach((controller) => controller.abort());
    taskAbortControllersRef.current.clear();
  }, []);

  const appendToolEvent = useCallback((text: string) => {
    setTranscripts((current) => [
      ...current,
      {
        id: createId("tool"),
        role: "tool",
        text,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      },
    ]);
  }, []);

  const getDocumentContext = useCallback((): StructuredDocument | null => {
    return editorRef.current?.readDocument() ?? {
      ...documentState,
      revision,
      selection: { ...selection, revision },
    };
  }, [documentState, revision, selection]);

  const proposePatch = useCallback((input: PatchToolInput) => {
    const document = getDocumentContext();
    if (!document) return JSON.stringify({ ok: false, error: "The editor is not ready." });

    const operations: DocumentPatchOperation[] = [];
    for (const requested of input.operations) {
      if (requested.target === "selection") {
        if (!document.selection.text.trim()) {
          return JSON.stringify({ ok: false, error: "No text is selected. Read the document and target a block_id instead." });
        }
        operations.push({
          target: "selection",
          blockId: null,
          from: document.selection.from,
          to: document.selection.to,
          originalText: document.selection.text,
          replacementText: requested.replacementText,
        });
        continue;
      }

      const block = document.blocks.find((candidate) => candidate.id === requested.blockId);
      if (!block) {
        return JSON.stringify({
          ok: false,
          error: `Unknown block_id: ${requested.blockId ?? "null"}. Read the latest document before proposing a patch.`,
        });
      }
      operations.push({
        target: "block",
        blockId: block.id,
        from: block.from + 1,
        to: block.to - 1,
        originalText: block.text,
        replacementText: requested.replacementText,
      });
    }

    const ordered = [...operations].sort((a, b) => a.from - b.from);
    if (ordered.some((operation, index) => index > 0 && operation.from < ordered[index - 1].to)) {
      return JSON.stringify({ ok: false, error: "Patch operations overlap. Use one operation for the shared target." });
    }

    const id = createId("patch");
    const proposal: PatchProposal = {
      id,
      operations,
      original: operations.map((operation) => `${operation.blockId ? `[${operation.blockId}] ` : ""}${operation.originalText}`).join("\n\n"),
      replacement: operations.map((operation) => `${operation.blockId ? `[${operation.blockId}] ` : ""}${operation.replacementText}`).join("\n\n"),
      rationale: input.rationale,
      baseRevision: document.revision,
      status: "pending",
    };
    setPatch(proposal);
    appendToolEvent(`文档补丁已生成 · ${operations.length} 个 block 操作等待语音确认`);
    return JSON.stringify({ ok: true, proposalId: id, operationCount: operations.length, status: "pending_user_decision" });
  }, [appendToolEvent, getDocumentContext]);

  const resolvePatch = useCallback((decision: "accept" | "reject" | "revise", feedback?: string) => {
    if (!patch || patch.status !== "pending") {
      return JSON.stringify({ ok: false, error: "There is no pending patch." });
    }

    if (decision === "revise") {
      appendToolEvent(feedback ? `Rewrite steering: ${feedback}` : "The user asked for another version");
      return JSON.stringify({ ok: true, status: "needs_revised_proposal", feedback });
    }

    if (decision === "reject") {
      setPatch({ ...patch, status: "rejected" });
      appendToolEvent("已通过语音拒绝文档补丁");
      return JSON.stringify({ ok: true, status: "rejected" });
    }

    if (patch.baseRevision !== revision) {
      appendToolEvent("Patch not applied because the document changed after it was proposed");
      return JSON.stringify({
        ok: false,
        error: "The document changed after this patch was proposed. Call read_document and propose a fresh patch.",
      });
    }

    const applied = editorRef.current?.applyPatchOperations(patch.operations) ?? false;
    if (!applied) return JSON.stringify({ ok: false, error: "The editor could not apply the patch." });

    setPatch({ ...patch, status: "accepted" });
    appendToolEvent("已通过语音接受文档补丁 · 可在编辑器中撤销");
    return JSON.stringify({ ok: true, status: "accepted", undoAvailable: true });
  }, [appendToolEvent, patch, revision]);

  const createArtifact = useCallback((artifact: Omit<CanvasArtifact, "id">) => {
    const id = createId("artifact");
    setArtifacts((current) => [{ ...artifact, id }, ...current]);
    setActiveTab("canvas");
    appendToolEvent(`Created Canvas artifact: ${artifact.title}`);
    return id;
  }, [appendToolEvent]);

  const executeDelegationBatch = useCallback(async (
    batchTasks: DelegatedTask[],
    document: StructuredDocument,
  ) => {
    const completedResults = new Map<string, DelegatedTaskResult>();

    const runTask = async (task: DelegatedTask) => {
      const controller = new AbortController();
      taskAbortControllersRef.current.set(task.id, controller);
      setTasks((current) => current.map((candidate) => candidate.id === task.id ? {
        ...candidate,
        status: "running",
        step: "后台 worker 正在执行",
      } : candidate));

      try {
        const response = await fetch("/api/delegation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            task: {
              taskKey: task.taskKey,
              title: task.title,
              summary: task.summary,
              instructions: task.instructions,
              targetBlockIds: task.targetBlockIds,
              outputKind: task.outputKind,
            },
            document: {
              revision: document.revision,
              title: document.title,
              blocks: document.blocks.map(({ id, type, level, text }) => ({ id, type, level, text })),
            },
            dependencyResults: task.dependsOn
              .map((taskKey) => {
                const result = completedResults.get(taskKey);
                return result ? { taskKey, summary: result.summary } : null;
              })
              .filter(Boolean),
          }),
          signal: controller.signal,
        });
        const payload = (await response.json()) as {
          error?: string;
          result?: {
            summary: string;
            edits: Array<{ block_id: string; replacement_text: string }>;
            artifact: Omit<CanvasArtifact, "id"> | null;
          };
        };
        if (!response.ok || !payload.result) {
          throw new Error(payload.error ?? "The background worker returned no result.");
        }

        const result: DelegatedTaskResult = {
          summary: payload.result.summary,
          edits: payload.result.edits.map((edit) => ({
            blockId: edit.block_id,
            originalText: document.blocks.find((block) => block.id === edit.block_id)?.text ?? "",
            replacementText: edit.replacement_text,
          })),
          artifact: payload.result.artifact,
        };
        completedResults.set(task.taskKey, result);
        setTasks((current) => current.map((candidate) => candidate.id === task.id ? {
          ...candidate,
          status: "review",
          progress: 100,
          step: "执行完成 · 等待你的审阅",
          result,
          error: undefined,
        } : candidate));
        appendToolEvent(`Delegation 完成，等待审阅：${task.title}`);
        return true;
      } catch (error) {
        if (controller.signal.aborted) return false;
        const message = error instanceof Error ? error.message : "The delegated task failed.";
        setTasks((current) => current.map((candidate) => candidate.id === task.id ? {
          ...candidate,
          status: "failed",
          progress: 100,
          step: "执行失败",
          error: message,
        } : candidate));
        appendToolEvent(`Delegation 失败：${task.title}`);
        return false;
      } finally {
        taskAbortControllersRef.current.delete(task.id);
      }
    };

    if (batchTasks[0]?.executionMode === "parallel") {
      await Promise.all(batchTasks.map(runTask));
      return;
    }

    const remaining = new Map(batchTasks.map((task) => [task.taskKey, task]));
    const successful = new Set<string>();
    while (remaining.size > 0) {
      const ready = Array.from(remaining.values()).filter((task) =>
        task.dependsOn.every((dependency) => successful.has(dependency))
      );
      if (ready.length === 0) {
        setTasks((current) => current.map((task) => remaining.has(task.taskKey) ? {
          ...task,
          status: "failed",
          progress: 100,
          step: "依赖任务未成功完成",
          error: "A required dependency failed or was cancelled.",
        } : task));
        return;
      }
      const outcomes = await Promise.all(ready.map(async (task) => ({ task, ok: await runTask(task) })));
      outcomes.forEach(({ task, ok }) => {
        remaining.delete(task.taskKey);
        if (ok) successful.add(task.taskKey);
      });
    }
  }, [appendToolEvent]);

  const startTasks = useCallback((input: DelegationBatchToolInput) => {
    const document = getDocumentContext();
    if (!document) return JSON.stringify({ ok: false, error: "The editor is not ready." });

    const taskKeys = input.tasks.map((task) => task.taskKey);
    const uniqueTaskKeys = new Set(taskKeys);
    if (uniqueTaskKeys.size !== taskKeys.length) {
      return JSON.stringify({ ok: false, error: "Every delegated task must have a unique task_key." });
    }

    const unknownDependencies = input.tasks
      .flatMap((task) => task.dependsOn)
      .filter((dependency) => !uniqueTaskKeys.has(dependency));
    if (unknownDependencies.length > 0) {
      return JSON.stringify({
        ok: false,
        error: `Unknown dependency task keys: ${Array.from(new Set(unknownDependencies)).join(", ")}.`,
      });
    }
    if (input.tasks.some((task) => task.dependsOn.includes(task.taskKey)) || hasDependencyCycle(input.tasks)) {
      return JSON.stringify({ ok: false, error: "Delegated task dependencies must form an acyclic graph." });
    }
    if (input.executionMode === "parallel" && input.tasks.some((task) => task.dependsOn.length > 0)) {
      return JSON.stringify({ ok: false, error: "Parallel batches cannot contain depends_on edges." });
    }

    const knownBlockIds = new Set(document.blocks.map((block) => block.id));
    const unknownBlockIds = input.tasks
      .flatMap((input) => input.targetBlockIds)
      .filter((blockId) => !knownBlockIds.has(blockId));
    if (unknownBlockIds.length > 0) {
      return JSON.stringify({
        ok: false,
        error: `Unknown block IDs: ${Array.from(new Set(unknownBlockIds)).join(", ")}. Read the latest document before delegating.`,
      });
    }

    const batchId = createId("batch");
    const created = input.tasks.map((task) => ({
      id: createId("task"),
      batchId,
      batchSummary: input.batchSummary,
      executionMode: input.executionMode,
      taskKey: task.taskKey,
      baseRevision: document.revision,
      title: task.title,
      summary: task.summary,
      instructions: task.instructions,
      targetBlockIds: task.targetBlockIds,
      outputKind: task.outputKind,
      dependsOn: task.dependsOn,
      status: "queued" as const,
      progress: 5,
      step: task.dependsOn.length === 0
        ? "并行任务已就绪 · 等待后台 worker 接管"
        : `等待依赖任务：${task.dependsOn.join(", ")}`,
    }));
    setTasks((current) => [...created, ...current]);
    appendToolEvent(input.executionMode === "parallel"
      ? `已原子提交 ${created.length} 个并行 delegation 任务`
      : `已提交包含依赖关系的 ${created.length} 个 delegation 任务`);
    setActiveTab("tasks");
    window.setTimeout(() => {
      void executeDelegationBatch(created, document);
    }, 250);
    return JSON.stringify({
      ok: true,
      batchId,
      baseRevision: document.revision,
      executionMode: input.executionMode,
      status: "queued",
      tasks: created.map((task) => ({
        taskId: task.id,
        taskKey: task.taskKey,
        targetBlockIds: task.targetBlockIds,
        dependsOn: task.dependsOn,
      })),
    });
  }, [appendToolEvent, executeDelegationBatch, getDocumentContext]);

  const handleSetProactiveMode = useCallback((mode: ProactiveMode) => {
    setProactiveMode(mode);
    appendToolEvent(mode === "suggest" ? "主动建议已开启" : "主动建议已关闭");
    return JSON.stringify({ ok: true, mode });
  }, [appendToolEvent]);

  const handleHistory = useCallback((entries: TranscriptEntry[]) => {
    setTranscripts((current) => {
      const localToolEvents = current.filter((entry) => entry.role === "tool");
      const merged = new Map<string, TranscriptEntry>();
      [...entries, ...localToolEvents].forEach((entry) => merged.set(entry.id, entry));
      return Array.from(merged.values());
    });
  }, []);

  const realtimeCallbacks = useMemo(() => ({
    getDocumentContext,
    proposePatch,
    resolvePatch,
    createArtifact,
    startTasks,
    setProactiveMode: handleSetProactiveMode,
    onHistory: handleHistory,
    onToolEvent: appendToolEvent,
  }), [appendToolEvent, createArtifact, getDocumentContext, handleHistory, handleSetProactiveMode, proposePatch, resolvePatch, startTasks]);

  const voice = useRealtimeVoice(realtimeCallbacks);
  const voiceStatus = voice.status;
  const notifyWorkspaceIdle = voice.notifyWorkspaceIdle;

  useEffect(() => {
    if (proactiveTimerRef.current !== null) window.clearTimeout(proactiveTimerRef.current);
    if (
      proactiveMode !== "suggest"
      || voiceStatus !== "listening"
      || patch?.status === "pending"
      || documentState.revision <= lastProactiveRevisionRef.current
    ) return;

    proactiveTimerRef.current = window.setTimeout(() => {
      const now = Date.now();
      if (now - lastProactiveAtRef.current < 30_000) {
        lastProactiveRevisionRef.current = documentState.revision;
        return;
      }

      const document = editorRef.current?.readDocument();
      if (!document) return;
      const sent = notifyWorkspaceIdle({
        revision: document.revision,
        blockIds: document.selection.blockIds,
      });
      if (sent) {
        lastProactiveRevisionRef.current = document.revision;
        lastProactiveAtRef.current = now;
      }
    }, 5_000);

    return () => {
      if (proactiveTimerRef.current !== null) window.clearTimeout(proactiveTimerRef.current);
    };
  }, [documentState.revision, notifyWorkspaceIdle, patch?.status, proactiveMode, voiceStatus]);

  const updateTask = useCallback((taskId: string, update: (task: DelegatedTask) => DelegatedTask) => {
    setTasks((current) => current.map((task) => task.id === taskId ? update(task) : task));
  }, []);

  const acceptTaskResult = useCallback((taskId: string) => {
    const task = tasks.find((candidate) => candidate.id === taskId);
    if (!task?.result || task.status !== "review") return;

    const currentDocument = editorRef.current?.readDocument();
    if (!currentDocument) return;
    const operations: DocumentPatchOperation[] = [];
    for (const edit of task.result.edits) {
      const block = currentDocument.blocks.find((candidate) => candidate.id === edit.blockId);
      if (!block || block.text !== edit.originalText) {
        updateTask(taskId, (candidate) => ({
          ...candidate,
          status: "failed",
          step: "无法应用 · 目标段落已发生变化",
          error: "The target block changed while the task was running. Please delegate it again.",
        }));
        appendToolEvent(`未应用后台结果，段落已变化：${task.title}`);
        return;
      }
      operations.push({
        target: "block",
        blockId: block.id,
        from: block.from + 1,
        to: block.to - 1,
        originalText: block.text,
        replacementText: edit.replacementText,
      });
    }

    if (operations.length > 0 && !editorRef.current?.applyPatchOperations(operations)) {
      updateTask(taskId, (candidate) => ({ ...candidate, status: "failed", step: "编辑器无法应用结果" }));
      return;
    }
    if (task.result.artifact) createArtifact(task.result.artifact);
    updateTask(taskId, (candidate) => ({
      ...candidate,
      status: "completed",
      progress: 100,
      step: task.result?.artifact ? "已添加到 Canvas" : "修改已应用 · 可在编辑器中撤销",
    }));
    appendToolEvent(`已接受后台结果：${task.title}`);
  }, [appendToolEvent, createArtifact, tasks, updateTask]);

  const dismissTaskResult = useCallback((taskId: string) => {
    updateTask(taskId, (task) => ({
      ...task,
      status: "completed",
      progress: 100,
      step: "结果已跳过 · 文档未修改",
    }));
  }, [updateTask]);

  const cancelTask = useCallback((taskId: string) => {
    taskAbortControllersRef.current.get(taskId)?.abort();
    updateTask(taskId, (task) => ({
      ...task,
      status: "cancelled",
      step: "已停止后台请求",
    }));
  }, [updateTask]);

  const handleDocumentChange = useCallback((document: StructuredDocument) => {
    setDocumentState(document);
    setRevision(document.revision);
  }, []);

  const selectedCharacters = charactersIn(selection.text);
  const connected = !["idle", "error"].includes(voice.status);
  const voiceContext = patch?.status === "pending"
    ? "改写建议等待确认 · 可以说“接受”“拒绝”或继续调整"
    : selectedCharacters > 0
      ? `已关联 ${selection.blockIds.length} 个 block · ${selectedCharacters} 字 · 可以直接说“改写这部分”`
      : connected
        ? "选中文字可聚焦讨论，也可以直接谈整份文档"
        : "点击一次并允许麦克风权限，即可开始实时语音";

  return (
    <main className="app-frame">
      <section className="app-shell">
        <header className="app-header">
          <div className="app-brand">
            <div className="app-brand__mark"><Sparkles aria-hidden="true" /></div>
            <div>
              <strong>Vibe Workspace</strong>
              <span>Product strategy · Saved locally</span>
            </div>
          </div>
          <div className="connection-pill" data-status={voice.status}>
            <span /> {voiceLabel(voice.status)}
          </div>
          <div className="app-header__actions">
            <button type="button"><Share2 aria-hidden="true" /> Share</button>
            <button type="button" aria-label="Workspace menu"><ChevronDown aria-hidden="true" /></button>
          </div>
        </header>

        <div className="workspace-layout">
          <section className="workspace-editor">
            <DocumentEditor
              ref={editorRef}
              revision={revision}
              onSelectionChange={setSelection}
              onDocumentChange={handleDocumentChange}
            />

            {selectedCharacters > 0 ? (
              <div className="selection-context" aria-live="polite">
                <span /> 选区已关联语音 · {selection.blockIds.length} blocks · {selectedCharacters} 字
              </div>
            ) : null}

            <div className="voice-bar" data-status={voice.status}>
              <button
                className="voice-bar__mic"
                type="button"
                aria-label={connected ? (voice.status === "muted" ? "Resume voice" : "Pause voice") : "Start voice"}
                onClick={connected ? voice.toggleMute : voice.connect}
              >
                {voice.status === "muted" ? <MicOff aria-hidden="true" /> : <Mic aria-hidden="true" />}
              </button>
              <div className="voice-bar__copy">
                <div className="voice-bar__status">
                  {voice.status === "speaking" ? <Volume2 aria-hidden="true" /> : voice.status === "thinking" ? <Sparkles aria-hidden="true" /> : <AudioLines aria-hidden="true" />}
                  <strong>{voiceLabel(voice.status)}</strong>
                  {voice.status === "listening" ? <span className="voice-wave"><i /><i /><i /><i /></span> : null}
                </div>
                <p>{voice.error ?? voiceContext}</p>
              </div>
              <button
                className="voice-bar__proactive"
                type="button"
                aria-label={proactiveMode === "suggest" ? "关闭主动建议" : "开启主动建议"}
                aria-pressed={proactiveMode === "suggest"}
                data-active={proactiveMode === "suggest" || undefined}
                title="主动建议"
                onClick={() => handleSetProactiveMode(proactiveMode === "suggest" ? "off" : "suggest")}
              >
                <Sparkles aria-hidden="true" />
                <span>主动</span>
              </button>
              {connected ? (
                <button className="voice-bar__end" type="button" aria-label="End voice session" onClick={voice.disconnect}>
                  <StopCircle aria-hidden="true" />
                </button>
              ) : null}
            </div>
          </section>

          <WorkspaceRail
            activeTab={activeTab}
            onTabChange={setActiveTab}
            patch={patch}
            onResolvePatch={(decision) => { resolvePatch(decision); }}
            artifacts={artifacts}
            transcripts={transcripts}
            tasks={tasks}
            onAcceptTaskResult={acceptTaskResult}
            onDismissTaskResult={dismissTaskResult}
            onCancelTask={cancelTask}
          />
        </div>
      </section>
    </main>
  );
}
