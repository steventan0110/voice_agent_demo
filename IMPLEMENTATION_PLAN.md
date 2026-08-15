# Vibe Voice Workspace — Implementation Plan

## Product invariant

The document is the user's source of truth. Voice is the primary control surface. Canvas is an output surface for visual or delegated work, not a destination that users manually send selections to.

## Phase 1 — Interactive vertical slice

- Build the responsive 65/35 document + workspace layout.
- Use a structured Tiptap editor and expose the active selection as stable runtime context.
- Show Canvas, Conversation, and Tasks views.
- Support patch proposals with accept, reject, revise, and undo-friendly state.
- Give buttons as fallback controls, while routing voice decisions through the same commands.

Success criterion: select text, ask for a rewrite, preview a diff, and accept or reject it without leaving the document.

## Phase 2 — Realtime voice session

- Mint short-lived Realtime client secrets on the server using `GPT_KEY`.
- Connect the browser with `RealtimeSession` over WebRTC.
- Stream user and assistant transcripts into Conversation.
- Reflect listening, thinking, speaking, muted, and error states in the always-on voice bar.
- Handle interruption and disconnect cleanly.

Success criterion: a browser voice turn produces audio, transcript updates, and a visible connection state without exposing the standard API key.

## Phase 3 — Document and Canvas tools

- Store the editor canonically as Tiptap JSON and assign stable IDs to every heading and paragraph.
- Project the current state into XML for model reads; provide Markdown and JSON as secondary formats.
- Include global order, per-type indices, revision, and active-selection block references.
- `read_document`
- `propose_document_patch`
- `resolve_document_patch`
- `create_canvas_artifact`
- `delegate_tasks`

For the first slice these tools execute in the browser against local workspace state. Server-side sideband execution will replace sensitive or durable operations later.

Success criterion: spoken references such as “第一段”, “第二个标题”, and “this section” resolve to stable blocks or the current selection, and spoken accept/reject commands resolve the current patch.

## Phase 4 — Delegated tasks

- Define task lifecycle: queued, running, paused, completed, failed, cancelled.
- Let one `delegate_tasks` call create up to six independent tasks, each bound to its own block IDs and output kind.
- Represent the call as an atomic task graph: unique task keys, explicit execution mode, and dependency edges only when one result consumes another.
- Return a task ID immediately so the Realtime agent can reassure the user and continue the conversation.
- Add progress, steering, pause/resume, and cancel commands.
- Preserve partial artifacts after cancellation.
- Add a server-side task endpoint and event stream. A worker receives an immutable document snapshot plus target blocks, and returns either patch operations or Canvas artifacts.
- Use optimistic revision checks before applying worker results; stale results become reviewable proposals instead of silent writes.

Success criterion: a long task never blocks the live voice session and remains observable and controllable.

## Phase 5 — Persistence and safety

- Persist Tiptap JSON, revisions, patches, artifacts, transcripts, and task events.
- Add revision checks and idempotency keys to document writes.
- Move business logic and delegated execution to a server-side control channel.
- Render arbitrary HTML only in a sandboxed iframe with a strict CSP.
- Add auth, rate limits, usage telemetry, and evals for tool selection and deictic references.

## Bounded proactivity

- Proactivity is opt-in through `set_proactive_mode`; the default is off.
- While suggest mode is enabled, meaningful document edits are debounced for five seconds before emitting a private `editor_idle` event to the Realtime session.
- The event is sent only while the session is listening and no patch decision is pending, with a 30-second cooldown.
- The agent may offer one concise suggestion, but cannot proactively edit, render, search, or delegate without confirmation.
- A future background observer can replace the Realtime event when silent, non-audio suggestions and richer ranking are needed.

## Current scope and next backend seam

The current implementation covers Phases 1–3, stable document addressing, multi-task batching, and the first working slice of Phase 4. `delegate_tasks` now launches independent Responses API workers concurrently, moves each task from 5% to a reviewable result, and keeps document changes behind explicit Apply or Dismiss controls.

The next server slice should accept a batch shaped like:

```ts
{
  batchId: string;
  baseRevision: number;
  documentXml: string;
  tasks: Array<{
    taskId: string;
    targetBlockIds: string[];
    instructions: string;
    outputKind: "research_rewrite" | "polish" | "research" | "mermaid" | "html" | "brief";
    dependsOn: string[];
  }>;
}
```

Each task runs independently and emits progress events. Results are normalized to either block-aware patch operations or sandboxed Canvas artifacts. Durable persistence and the actual worker model are deferred until its model, search policy, and storage boundary are chosen.

Canvas diagrams use Mermaid DSL as their stored representation and responsive SVG as their rendered representation. Mermaid is initialized with strict security settings; arbitrary interactive directives and links are not part of the artifact contract.
