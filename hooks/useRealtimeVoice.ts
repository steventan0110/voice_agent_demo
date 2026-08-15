"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  RealtimeAgent,
  RealtimeItem,
  RealtimeSession,
  tool,
} from "@openai/agents/realtime";
import { z } from "zod";
import { WORKSPACE_AGENT_INSTRUCTIONS } from "@/lib/agent-instructions";
import { serializeDocument } from "@/lib/document-model";
import type {
  CanvasArtifact,
  ProactiveMode,
  StructuredDocument,
  TranscriptEntry,
  VoiceStatus,
} from "@/lib/workspace-types";

export type PatchToolInput = {
  operations: Array<{
    target: "selection" | "block";
    blockId: string | null;
    replacementText: string;
  }>;
  rationale?: string;
};

export type DelegationToolInput = {
  taskKey: string;
  title: string;
  summary: string;
  instructions: string;
  targetBlockIds: string[];
  outputKind: "research_rewrite" | "polish" | "research" | "mermaid" | "html" | "brief";
  dependsOn: string[];
};

export type DelegationBatchToolInput = {
  batchSummary: string;
  executionMode: "parallel" | "dependency_graph";
  tasks: DelegationToolInput[];
};

type RealtimeCallbacks = {
  getDocumentContext: () => StructuredDocument | null;
  proposePatch: (input: PatchToolInput) => string;
  resolvePatch: (decision: "accept" | "reject" | "revise", feedback?: string) => string;
  createArtifact: (artifact: Omit<CanvasArtifact, "id">) => string;
  startTasks: (input: DelegationBatchToolInput) => string;
  setProactiveMode: (mode: ProactiveMode) => string;
  onHistory: (entries: TranscriptEntry[]) => void;
  onToolEvent: (text: string) => void;
};

type TokenResponse = {
  clientSecret: string;
  model: string;
  voice: string;
  error?: string;
};

function realtimeHistoryToTranscript(history: RealtimeItem[]): TranscriptEntry[] {
  const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return history.flatMap((item) => {
    if (item.type !== "message" || item.role === "system") return [];

    const text = item.content
      .map((content) => {
        if ("text" in content) return content.text;
        if ("transcript" in content) return content.transcript ?? "";
        return "";
      })
      .filter(Boolean)
      .join("\n");

    if (!text) return [];
    if (text.includes("<workspace_event")) return [];

    return [
      {
        id: item.itemId,
        role: item.role,
        text,
        timestamp: now,
        pending: item.status === "in_progress",
      } satisfies TranscriptEntry,
    ];
  });
}

export function useRealtimeVoice(callbacks: RealtimeCallbacks) {
  const callbacksRef = useRef(callbacks);
  const sessionRef = useRef<RealtimeSession | null>(null);
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    callbacksRef.current = callbacks;
  }, [callbacks]);

  useEffect(() => {
    return () => {
      sessionRef.current?.close();
      sessionRef.current = null;
    };
  }, []);

  const connect = useCallback(async () => {
    if (sessionRef.current || status === "connecting") return;

    setStatus("connecting");
    setError(null);

    try {
      const response = await fetch("/api/realtime/token", { method: "POST" });
      const token = (await response.json()) as TokenResponse;

      if (!response.ok || !token.clientSecret) {
        throw new Error(token.error ?? "Unable to start the voice session.");
      }

      const readDocument = tool({
        name: "read_document",
        description: "Read the current document with stable block IDs, semantic block types, paragraph/heading indices, revision, and active selection. Use XML for reliable references such as 'the first paragraph' or 'this section'.",
        parameters: z.object({
          format: z.enum(["xml", "markdown", "json"]).describe("Use xml by default; markdown is for readability; json is for programmatic inspection."),
          scope: z.enum(["full", "selection", "blocks", "outline"]).describe("Which part of the document to return."),
          block_ids: z.array(z.string()).describe("Required only for blocks scope; otherwise pass an empty array."),
        }),
        execute: async ({ format, scope, block_ids }) => {
          const document = callbacksRef.current.getDocumentContext();
          if (!document) return JSON.stringify({ ok: false, error: "The editor is not ready." });
          return serializeDocument(document, format, scope, block_ids);
        },
      });

      const proposeDocumentPatch = tool({
        name: "propose_document_patch",
        description: "Propose one visible, reversible patch containing one or more text replacements. Target a stable block_id from read_document, or target the current selection. This does not apply the change.",
        parameters: z.object({
          operations: z.array(z.object({
            target: z.enum(["selection", "block"]),
            block_id: z.string().nullable().describe("The exact block ID for a block target; null for a selection target."),
            replacement_text: z.string().describe("Complete plain-text replacement for this target. Preserve the block's semantic type."),
          })).min(1).max(8),
          rationale: z.string().optional().describe("A short reason for the rewrite."),
        }),
        execute: async ({ operations, rationale }) => callbacksRef.current.proposePatch({
          operations: operations.map((operation) => ({
            target: operation.target,
            blockId: operation.block_id,
            replacementText: operation.replacement_text,
          })),
          rationale,
        }),
      });

      const resolveDocumentPatch = tool({
        name: "resolve_document_patch",
        description: "Accept, reject, or request a revision to the currently pending document patch based on the user's spoken decision.",
        parameters: z.object({
          decision: z.enum(["accept", "reject", "revise"]),
          feedback: z.string().optional().describe("Additional steering when decision is revise."),
        }),
        execute: async ({ decision, feedback }) => callbacksRef.current.resolvePatch(decision, feedback),
      });

      const createCanvasArtifact = tool({
        name: "create_canvas_artifact",
        description: "Create a small result immediately on Canvas. Use type=mermaid for diagrams; never put Mermaid source in an HTML artifact.",
        parameters: z.object({
          type: z.enum(["mermaid", "brief", "comparison", "html"]),
          title: z.string(),
          body: z.string().describe("For mermaid: raw Mermaid DSL without Markdown fences, HTML, click actions, links, directives, or frontmatter. Use ASCII node IDs and quoted labels. For HTML: a static HTML fragment without scripts."),
          source: z.string().describe("Short description of the spoken request that created this artifact."),
        }),
        execute: async (artifact) => {
          const artifactId = callbacksRef.current.createArtifact(artifact);
          return JSON.stringify({ ok: true, artifactId });
        },
      });

      const delegateTasks = tool({
        name: "delegate_tasks",
        description: "Atomically launch a batch of background tasks. Put every independent deliverable from the current user turn into this one call so they can run concurrently. Use depends_on only for real data dependencies, never to express speaking order.",
        parameters: z.object({
          batch_summary: z.string().describe("One concise summary covering the whole batch."),
          execution_mode: z.enum(["parallel", "dependency_graph"]).describe("Use parallel when every task can begin immediately."),
          tasks: z.array(z.object({
            task_key: z.string().describe("Unique short key within this batch, such as diagram or polish_block_2."),
            title: z.string(),
            summary: z.string(),
            instructions: z.string().describe("Self-contained instructions for the background worker."),
            target_block_ids: z.array(z.string()).describe("Stable document block IDs this task may read or propose changes for."),
            output_kind: z.enum(["research_rewrite", "polish", "research", "mermaid", "html", "brief"]),
            depends_on: z.array(z.string()).describe("task_key values that must complete first. Pass [] for independent tasks."),
          })).min(1).max(6),
        }),
        execute: async ({ batch_summary, execution_mode, tasks }) => callbacksRef.current.startTasks({
          batchSummary: batch_summary,
          executionMode: execution_mode,
          tasks: tasks.map((task) => ({
            taskKey: task.task_key,
            title: task.title,
            summary: task.summary,
            instructions: task.instructions,
            targetBlockIds: task.target_block_ids,
            outputKind: task.output_kind,
            dependsOn: task.depends_on,
          })),
        }),
      });

      const setProactiveMode = tool({
        name: "set_proactive_mode",
        description: "Turn bounded proactive editor suggestions on or off when the user explicitly asks. Suggest mode may offer one concise idea after an editor-idle event but never edits or delegates without confirmation.",
        parameters: z.object({
          mode: z.enum(["off", "suggest"]),
        }),
        execute: async ({ mode }) => callbacksRef.current.setProactiveMode(mode),
      });

      const agent = new RealtimeAgent({
        name: "Vibe workspace collaborator",
        instructions: WORKSPACE_AGENT_INSTRUCTIONS,
        tools: [
          readDocument,
          proposeDocumentPatch,
          resolveDocumentPatch,
          createCanvasArtifact,
          delegateTasks,
          setProactiveMode,
        ],
      });

      const session = new RealtimeSession(agent, {
        model: token.model,
        transport: "webrtc",
        config: {
          outputModalities: ["audio"],
          audio: {
            input: {
              transcription: { model: "gpt-live-transcribe" },
              turnDetection: {
                type: "semantic_vad",
                createResponse: true,
                interruptResponse: true,
              },
            },
            output: { voice: token.voice },
          },
          reasoning: { effort: "low" },
        },
        workflowName: "vibe-voice-workspace",
      });

      session.on("history_updated", (history) => {
        callbacksRef.current.onHistory(realtimeHistoryToTranscript(history));
      });
      session.on("agent_start", () => setStatus("thinking"));
      session.on("agent_tool_start", (_context, _agent, activeTool) => {
        setStatus("thinking");
        callbacksRef.current.onToolEvent(`Running ${activeTool.name}`);
      });
      session.on("audio_start", () => setStatus("speaking"));
      session.on("audio_stopped", () => setStatus("listening"));
      session.on("audio_interrupted", () => setStatus("listening"));
      session.on("error", (sessionError) => {
        console.error("Realtime session error", sessionError);
        setError("The voice session encountered an error.");
        setStatus("error");
      });

      await session.connect({ apiKey: token.clientSecret, model: token.model });
      sessionRef.current = session;
      setStatus("listening");
    } catch (connectError) {
      console.error("Failed to connect Realtime session", connectError);
      setError(connectError instanceof Error ? connectError.message : "Unable to start the voice session.");
      setStatus("error");
    }
  }, [status]);

  const toggleMute = useCallback(() => {
    const session = sessionRef.current;
    if (!session) {
      void connect();
      return;
    }

    const shouldMute = status !== "muted";
    session.mute(shouldMute);
    setStatus(shouldMute ? "muted" : "listening");
  }, [connect, status]);

  const disconnect = useCallback(() => {
    sessionRef.current?.close();
    sessionRef.current = null;
    setStatus("idle");
    setError(null);
  }, []);

  const notifyWorkspaceIdle = useCallback((input: {
    revision: number;
    blockIds: string[];
  }) => {
    const session = sessionRef.current;
    if (!session) return false;

    session.sendMessage(
      `<workspace_event type="editor_idle" revision="${input.revision}" block_ids="${input.blockIds.join(",")}">The user changed the document and then paused typing. This is a private application signal, not a spoken request. Follow the PROACTIVE SUGGESTIONS policy.</workspace_event>`,
    );
    return true;
  }, []);

  return { status, error, connect, toggleMute, disconnect, notifyWorkspaceIdle };
}
