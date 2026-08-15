export type WorkspaceTab = "canvas" | "conversation" | "tasks";
export type ProactiveMode = "off" | "suggest";

export type VoiceStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "muted"
  | "thinking"
  | "speaking"
  | "error";

export type SelectionContext = {
  from: number;
  to: number;
  text: string;
  blockIds: string[];
  revision: number;
};

export type DocumentBlockType = "heading" | "paragraph";

export type DocumentBlock = {
  id: string;
  type: DocumentBlockType;
  ordinal: number;
  typeOrdinal: number;
  level?: number;
  text: string;
  from: number;
  to: number;
  selected: boolean;
};

export type StructuredDocument = {
  schemaVersion: "1.0";
  revision: number;
  title: string;
  plainText: string;
  blocks: DocumentBlock[];
  selection: SelectionContext;
};

export type DocumentPatchOperation = {
  target: "selection" | "block";
  blockId: string | null;
  from: number;
  to: number;
  originalText: string;
  replacementText: string;
};

export type PatchProposal = {
  id: string;
  original: string;
  replacement: string;
  rationale?: string;
  operations: DocumentPatchOperation[];
  baseRevision: number;
  status: "pending" | "accepted" | "rejected";
};

export type TranscriptEntry = {
  id: string;
  role: "user" | "assistant" | "tool";
  text: string;
  timestamp: string;
  pending?: boolean;
};

export type CanvasArtifact = {
  id: string;
  type: "mermaid" | "brief" | "comparison" | "html";
  title: string;
  source: string;
  body: string;
};

export type DelegatedTaskStatus = "queued" | "running" | "review" | "completed" | "failed" | "cancelled";

export type DelegatedTaskResult = {
  summary: string;
  edits: Array<{
    blockId: string;
    originalText: string;
    replacementText: string;
  }>;
  artifact: Omit<CanvasArtifact, "id"> | null;
};

export type DelegatedTask = {
  id: string;
  batchId: string;
  batchSummary: string;
  executionMode: "parallel" | "dependency_graph";
  taskKey: string;
  baseRevision: number;
  title: string;
  summary: string;
  instructions: string;
  targetBlockIds: string[];
  outputKind: "research_rewrite" | "polish" | "research" | "mermaid" | "html" | "brief";
  dependsOn: string[];
  status: DelegatedTaskStatus;
  progress: number;
  step: string;
  steering?: string;
  result?: DelegatedTaskResult;
  error?: string;
};
