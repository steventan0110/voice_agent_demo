import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DelegationRequest = {
  task: {
    taskKey: string;
    title: string;
    summary: string;
    instructions: string;
    targetBlockIds: string[];
    outputKind: "research_rewrite" | "polish" | "research" | "mermaid" | "html" | "brief";
  };
  document: {
    revision: number;
    title: string;
    blocks: Array<{
      id: string;
      type: "heading" | "paragraph";
      level?: number;
      text: string;
    }>;
  };
  dependencyResults?: Array<{
    taskKey: string;
    summary: string;
  }>;
};

type ResponsesPayload = {
  output_text?: string;
  output?: Array<{
    content?: Array<{ type?: string; text?: string }>;
  }>;
  error?: { message?: string };
};

const RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    edits: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          block_id: { type: "string" },
          replacement_text: { type: "string" },
        },
        required: ["block_id", "replacement_text"],
      },
    },
    artifact: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          properties: {
            type: { type: "string", enum: ["mermaid", "brief", "comparison", "html"] },
            title: { type: "string" },
            body: { type: "string" },
            source: { type: "string" },
          },
          required: ["type", "title", "body", "source"],
        },
      ],
    },
  },
  required: ["summary", "edits", "artifact"],
} as const;

function responseText(payload: ResponsesPayload) {
  if (payload.output_text) return payload.output_text;
  return payload.output
    ?.flatMap((item) => item.content ?? [])
    .filter((content) => content.type === "output_text" && content.text)
    .map((content) => content.text)
    .join("\n");
}

function isDelegationRequest(value: unknown): value is DelegationRequest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DelegationRequest>;
  return Boolean(
    candidate.task
    && typeof candidate.task.taskKey === "string"
    && typeof candidate.task.instructions === "string"
    && Array.isArray(candidate.task.targetBlockIds)
    && candidate.document
    && typeof candidate.document.revision === "number"
    && Array.isArray(candidate.document.blocks),
  );
}

export async function POST(request: Request) {
  const apiKey = process.env.GPT_KEY;
  const model = process.env.OPENAI_DELEGATION_MODEL ?? "gpt-5.4";

  if (!apiKey) {
    return NextResponse.json({ error: "GPT_KEY is not configured on the server." }, { status: 500 });
  }

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (!isDelegationRequest(input)) {
    return NextResponse.json({ error: "Invalid delegation request." }, { status: 400 });
  }

  const targetIds = new Set(input.task.targetBlockIds);
  const targetBlocks = input.document.blocks.filter((block) => targetIds.has(block.id));
  if (targetBlocks.length !== targetIds.size) {
    return NextResponse.json({ error: "One or more target blocks are missing from the document snapshot." }, { status: 409 });
  }

  const requiresResearch = ["research", "research_rewrite"].includes(input.task.outputKind);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  request.signal.addEventListener("abort", () => controller.abort(), { once: true });

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        reasoning: { effort: "low" },
        max_output_tokens: 3_000,
        instructions: [
          "You are a background worker for a voice-native document editor.",
          "Complete exactly one delegated task and return only the requested structured result.",
          "Write in the same language as the supplied document unless the task says otherwise.",
          "For polish or research_rewrite, return complete replacement text in edits for the exact target block IDs. Do not change headings unless explicitly requested.",
          "For mermaid, return one artifact with raw Mermaid DSL: no code fence, HTML, click actions, links, directives, or frontmatter. Use ASCII node IDs and quoted labels.",
          "For html, return a static HTML fragment without scripts or remote assets.",
          "For research or brief, return a concise brief artifact. Never invent citations or claim research you did not perform.",
          "Do not include edits or artifacts that are unrelated to the task.",
        ].join("\n"),
        input: JSON.stringify({
          task: input.task,
          document: {
            revision: input.document.revision,
            title: input.document.title,
            outline: input.document.blocks.map(({ id, type, level, text }) => ({ id, type, level, text })),
            targetBlocks,
          },
          dependencyResults: input.dependencyResults ?? [],
        }),
        tools: requiresResearch ? [{ type: "web_search" }] : undefined,
        text: {
          format: {
            type: "json_schema",
            name: "delegated_task_result",
            strict: true,
            schema: RESULT_SCHEMA,
          },
        },
      }),
      cache: "no-store",
      signal: controller.signal,
    });

    const payload = (await response.json()) as ResponsesPayload;
    if (!response.ok) {
      return NextResponse.json(
        { error: payload.error?.message ?? "The delegation model request failed." },
        { status: response.status },
      );
    }

    const text = responseText(payload);
    if (!text) {
      return NextResponse.json({ error: "The delegation model returned no structured output." }, { status: 502 });
    }

    const result = JSON.parse(text) as {
      summary: string;
      edits: Array<{ block_id: string; replacement_text: string }>;
      artifact: null | { type: "mermaid" | "brief" | "comparison" | "html"; title: string; body: string; source: string };
    };

    const invalidEdit = result.edits.some((edit) => !targetIds.has(edit.block_id));
    if (invalidEdit) {
      return NextResponse.json({ error: "The worker returned an edit outside its allowed target blocks." }, { status: 502 });
    }
    const expectsEdits = ["polish", "research_rewrite"].includes(input.task.outputKind);
    const expectsArtifact = ["research", "mermaid", "html", "brief"].includes(input.task.outputKind);
    if ((expectsEdits && result.edits.length === 0) || (expectsArtifact && !result.artifact)) {
      return NextResponse.json({ error: "The worker result does not match the requested output kind." }, { status: 502 });
    }

    return NextResponse.json({ ok: true, model, result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json({ error: "The delegated task was cancelled or timed out." }, { status: 408 });
    }
    console.error("Delegation worker failed", error);
    return NextResponse.json({ error: "Unable to complete the delegated task." }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
