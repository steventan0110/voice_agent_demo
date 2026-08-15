"use client";

import {
  Check,
  GitBranch,
  LoaderCircle,
  RotateCcw,
  Square,
  X,
} from "lucide-react";
import { MermaidDiagram } from "./MermaidDiagram";
import type {
  CanvasArtifact,
  DelegatedTask,
  PatchProposal,
  TranscriptEntry,
  WorkspaceTab,
} from "@/lib/workspace-types";

type WorkspaceRailProps = {
  activeTab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
  patch: PatchProposal | null;
  onResolvePatch: (decision: "accept" | "reject") => void;
  artifacts: CanvasArtifact[];
  transcripts: TranscriptEntry[];
  tasks: DelegatedTask[];
  onCancelTask: (taskId: string) => void;
  onAcceptTaskResult: (taskId: string) => void;
  onDismissTaskResult: (taskId: string) => void;
};

function CanvasView({ artifacts, tasks, ...taskActions }: Pick<WorkspaceRailProps, "artifacts" | "tasks" | "onCancelTask" | "onAcceptTaskResult" | "onDismissTaskResult">) {
  return (
    <div className="workspace-rail__panel">
      {artifacts.map((artifact) => (
        <article className="canvas-artifact" key={artifact.id}>
          <header>
            <div>
              <h3>{artifact.title}</h3>
              <p>Created from voice · “{artifact.source}”</p>
            </div>
            <span>{artifact.type}</span>
          </header>
          {artifact.type === "mermaid" ? (
            <MermaidDiagram source={artifact.body} title={artifact.title} />
          ) : artifact.type === "html" ? (
            <iframe
              className="canvas-html"
              title={artifact.title}
              sandbox=""
              referrerPolicy="no-referrer"
              srcDoc={`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><style>body{margin:0;padding:16px;font:14px/1.5 system-ui;color:#17191d;background:#fff}*{box-sizing:border-box}</style></head><body>${artifact.body}</body></html>`}
            />
          ) : (
            <p className="canvas-artifact__body">{artifact.body}</p>
          )}
        </article>
      ))}

      {artifacts.length === 0 ? (
        <div className="workspace-empty">
          <GitBranch aria-hidden="true" />
          <h3>Canvas is ready</h3>
          <p>Ask by voice to draw a flow, compare options, or organize the discussion.</p>
        </div>
      ) : null}

      {tasks.filter((task) => task.status !== "completed").map((task) => (
        <TaskCard key={task.id} task={task} {...taskActions} />
      ))}
    </div>
  );
}

function ConversationView({ transcripts }: Pick<WorkspaceRailProps, "transcripts">) {
  if (transcripts.length === 0) {
    return (
      <div className="workspace-empty">
        <LoaderCircle aria-hidden="true" />
        <h3>No conversation yet</h3>
        <p>Start the voice session and speak naturally. Final and partial transcripts appear here.</p>
      </div>
    );
  }

  return (
    <div className="workspace-rail__panel conversation-list">
      {transcripts.map((entry) =>
        entry.role === "tool" ? (
          <div className="tool-event" key={entry.id}>{entry.text}</div>
        ) : (
          <article className="transcript" data-role={entry.role} key={entry.id}>
            <header>
              <span>{entry.role === "user" ? "You" : "Agent"}</span>
              <time>{entry.timestamp}</time>
            </header>
            <p>{entry.text}</p>
            {entry.pending ? <span className="transcript__pending">Live</span> : null}
          </article>
        ),
      )}
    </div>
  );
}

function TaskCard({ task, onCancelTask, onAcceptTaskResult, onDismissTaskResult }: Pick<WorkspaceRailProps, "onCancelTask" | "onAcceptTaskResult" | "onDismissTaskResult"> & { task: DelegatedTask }) {
  const statusLabel = task.status === "review" ? "Ready for review" : task.status;
  return (
    <article className="task-card">
      <header>
        <div>
          <h3>{task.title}</h3>
          <p>{task.summary}</p>
        </div>
        <span data-status={task.status}>{statusLabel}</span>
      </header>
      <div className="task-card__progress" aria-label={`${task.progress}% complete`}>
        <span style={{ width: `${task.progress}%` }} />
      </div>
      <div className="task-card__step"><span>{task.step}</span><span>{task.progress}%</span></div>
      <div className="task-card__meta">
        <span>{task.dependsOn.length === 0 ? "parallel-ready" : `waits for ${task.dependsOn.join(", ")}`}</span>
        <span>{task.outputKind.replaceAll("_", " ")}</span>
        <span>rev {task.baseRevision}</span>
        {task.targetBlockIds.map((blockId) => <code key={blockId}>{blockId}</code>)}
      </div>
      {task.steering ? <p className="task-card__steering">Steering: {task.steering}</p> : null}
      {task.error ? <p className="task-card__error">{task.error}</p> : null}
      {task.result ? (
        <div className="task-result">
          <p className="task-result__summary">{task.result.summary}</p>
          {task.result.edits.map((edit) => (
            <div className="task-result__diff" key={edit.blockId}>
              <code>{edit.blockId}</code>
              <p className="task-result__old">{edit.originalText}</p>
              <p className="task-result__new">{edit.replacementText}</p>
            </div>
          ))}
          {task.result.artifact ? (
            <div className="task-result__artifact">
              <strong>{task.result.artifact.title}</strong>
              <span>{task.result.artifact.type} · 接受后添加到 Canvas</span>
            </div>
          ) : null}
        </div>
      ) : null}
      {task.status === "review" ? (
        <div className="task-card__actions">
          <button type="button" onClick={() => onAcceptTaskResult(task.id)}>
            <Check aria-hidden="true" /> {task.result?.artifact ? "Add to Canvas" : "Apply"}
          </button>
          <button className="task-card__cancel" type="button" onClick={() => onDismissTaskResult(task.id)}>
            <X aria-hidden="true" /> Dismiss
          </button>
        </div>
      ) : ["queued", "running"].includes(task.status) ? (
        <div className="task-card__actions">
          <button className="task-card__cancel" type="button" onClick={() => onCancelTask(task.id)}>
            <Square aria-hidden="true" /> Cancel
          </button>
        </div>
      ) : null}
    </article>
  );
}

function TasksView(props: Pick<WorkspaceRailProps, "tasks" | "onCancelTask" | "onAcceptTaskResult" | "onDismissTaskResult">) {
  if (props.tasks.length === 0) {
    return (
      <div className="workspace-empty">
        <LoaderCircle aria-hidden="true" />
        <h3>No delegated work</h3>
        <p>Longer research and generation tasks will remain controllable from here.</p>
      </div>
    );
  }

  const batches = new Map<string, DelegatedTask[]>();
  props.tasks.forEach((task) => {
    batches.set(task.batchId, [...(batches.get(task.batchId) ?? []), task]);
  });

  return (
    <div className="workspace-rail__panel">
      {Array.from(batches.entries()).map(([batchId, tasks]) => {
        const isParallel = tasks[0]?.executionMode === "parallel";
        return (
          <section className="task-batch" key={batchId}>
            <header className="task-batch__header">
              <div>
                <strong>{isParallel ? "Parallel batch" : "Dependency graph"}</strong>
                <span>{tasks[0]?.batchSummary}</span>
              </div>
              <span>{isParallel ? `${tasks.length} 并行` : `${tasks.length} 有依赖`}</span>
            </header>
            {tasks.map((task) => <TaskCard key={task.id} task={task} {...props} />)}
          </section>
        );
      })}
    </div>
  );
}

export function WorkspaceRail(props: WorkspaceRailProps) {
  const pendingCount = props.tasks.filter((task) => ["queued", "running", "review"].includes(task.status)).length;

  return (
    <aside className="workspace-rail">
      <header className="workspace-rail__header">
        <div className="workspace-rail__title">
          <strong>Workspace</strong>
          <span>{props.patch?.status === "pending" ? "Suggestion waiting" : "Voice context synced"}</span>
        </div>
        <div className="workspace-rail__tabs" role="tablist" aria-label="Workspace views">
          {(["canvas", "conversation", "tasks"] as const).map((tab) => (
            <button
              type="button"
              role="tab"
              aria-selected={props.activeTab === tab}
              key={tab}
              onClick={() => props.onTabChange(tab)}
            >
              {tab[0].toUpperCase() + tab.slice(1)}
              {tab === "tasks" && pendingCount > 0 ? <span>{pendingCount}</span> : null}
            </button>
          ))}
        </div>
      </header>

      {props.patch ? (
        <section className="patch-card" data-status={props.patch.status}>
          <header>
            <div>
              <strong>Suggested rewrite</strong>
              <span>{props.patch.status === "pending" ? "Waiting for your decision" : props.patch.status}</span>
            </div>
            {props.patch.status === "accepted" ? <Check aria-hidden="true" /> : null}
            {props.patch.status === "rejected" ? <X aria-hidden="true" /> : null}
          </header>
          <p className="patch-card__old">{props.patch.original}</p>
          <p className="patch-card__new">{props.patch.replacement}</p>
          {props.patch.rationale ? <p className="patch-card__rationale">{props.patch.rationale}</p> : null}
          {props.patch.status === "pending" ? (
            <>
              <p className="patch-card__hint">Say “accept”, “reject”, or keep steering the rewrite.</p>
              <div className="patch-card__actions" aria-label="Fallback patch controls">
                <button type="button" onClick={() => props.onResolvePatch("accept")}><Check aria-hidden="true" /> Accept</button>
                <button type="button" onClick={() => props.onResolvePatch("reject")}><X aria-hidden="true" /> Dismiss</button>
              </div>
            </>
          ) : props.patch.status === "accepted" ? (
            <p className="patch-card__hint"><RotateCcw aria-hidden="true" /> Applied. The editor undo command remains available.</p>
          ) : null}
        </section>
      ) : null}

      {props.activeTab === "canvas" ? <CanvasView {...props} /> : null}
      {props.activeTab === "conversation" ? <ConversationView transcripts={props.transcripts} /> : null}
      {props.activeTab === "tasks" ? <TasksView {...props} /> : null}
    </aside>
  );
}
