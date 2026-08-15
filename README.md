# Vibe Voice Workspace

A voice-native document workspace built with Next.js, Tiptap, and the OpenAI Agents SDK Realtime package.

## What is implemented

- Responsive document + workspace layout based on the approved prototype.
- Chinese PRD starter document with complete and intentionally unfinished sections.
- Structured rich-text editing with stable block IDs and live selection context.
- XML, Markdown, and JSON model-facing document serialization.
- Canvas, Conversation, and Tasks views.
- Block-aware multi-operation patches shared by voice tools and fallback UI controls.
- Working delegation execution: one voice turn can launch several block-scoped Responses API tasks.
- Atomic parallel task batches with explicit dependency edges when needed.
- Mermaid diagrams rendered to responsive SVG with strict security settings and visible syntax errors.
- Sandboxed rendering for static HTML Canvas artifacts.
- Independent task results with review/apply controls and request cancellation.
- Realtime WebRTC session lifecycle and transcript rendering.
- Server-only creation of short-lived Realtime client secrets.

The current task implementation runs real requests while the browser session is open. It does not yet persist document/task state or continue work after the page closes.

## Setup

The project expects a standard OpenAI API key in `.env`:

```bash
GPT_KEY=your_openai_api_key
```

Optional overrides:

```bash
OPENAI_REALTIME_MODEL=gpt-realtime-2.1
OPENAI_REALTIME_VOICE=marin
OPENAI_DELEGATION_MODEL=gpt-5.4
```

Never expose `GPT_KEY` through a `NEXT_PUBLIC_` variable. The browser calls `/api/realtime/token` and receives only a short-lived client secret.

## Development

Node.js 20 or newer is recommended.

```bash
pnpm install
pnpm dev
```

Then open [http://localhost:3000](http://localhost:3000), select text in the document, and click **Start voice** to grant microphone access.

## Verification

```bash
pnpm typecheck
pnpm lint
pnpm build
```

## Realtime tools

- `read_document`
- `propose_document_patch`
- `resolve_document_patch`
- `create_canvas_artifact`
- `delegate_tasks`
- `set_proactive_mode`

Realtime tools currently coordinate browser state. Delegated model calls run in a server-only route so `GPT_KEY` is never exposed to the browser. Durable execution and persistence should move to a queue-backed sideband controller in a later backend phase.

## Document protocol

Tiptap JSON remains the canonical editor state. Each heading and paragraph receives a stable `block_id`. The Realtime model normally reads an XML projection that includes document revision, block type, global order, paragraph/heading indices, and the active selection. Markdown is available as a readable projection, but it is not used as the write address because Markdown alone cannot preserve stable block identity.

Patch and delegation tools must target `block_id` values returned by the latest `read_document` call. This keeps references such as “第一段” or “第二个标题” deterministic and allows the app to reject stale writes when the revision changes.

## Canvas diagrams

Diagram artifacts use `type: "mermaid"` and carry raw Mermaid DSL. Do not wrap the DSL in Markdown fences or place it in an HTML artifact. The browser dynamically loads Mermaid, renders the definition to SVG with `securityLevel: "strict"`, and shows the source plus a parse error when syntax is invalid.

Compound voice requests are submitted through one `delegate_tasks` batch. Independent jobs use `execution_mode: "parallel"` and `depends_on: []`; true pipelines use `execution_mode: "dependency_graph"` with explicit task-key dependencies.

Each task is executed by the server-only `/api/delegation` worker with `OPENAI_DELEGATION_MODEL` (default `gpt-5.4`). Parallel batches issue their requests concurrently. A task remains at 5% while running, then becomes independently reviewable at 100%; document edits are applied only after the user accepts that task's result.

See [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) for the staged architecture.
See [DEMO_SCRIPT.md](./DEMO_SCRIPT.md) for a complete voice demo sequence and expected tool calls.
