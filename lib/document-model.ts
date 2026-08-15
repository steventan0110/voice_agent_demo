import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type {
  DocumentBlock,
  SelectionContext,
  StructuredDocument,
} from "@/lib/workspace-types";

export type DocumentReadFormat = "xml" | "markdown" | "json";
export type DocumentReadScope = "full" | "selection" | "blocks" | "outline";

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function selectionTouchesBlock(from: number, to: number, block: Pick<DocumentBlock, "from" | "to">) {
  if (from === to) return from >= block.from && from <= block.to;
  return from < block.to && to > block.from;
}

export function buildStructuredDocument(
  doc: ProseMirrorNode,
  selection: { from: number; to: number },
  revision: number,
): StructuredDocument {
  const blocks: DocumentBlock[] = [];
  const typeCounts: Record<string, number> = {};

  doc.descendants((node, pos) => {
    if (node.type.name !== "heading" && node.type.name !== "paragraph") return;

    const id = typeof node.attrs.blockId === "string" ? node.attrs.blockId : "";
    if (!id) return;

    typeCounts[node.type.name] = (typeCounts[node.type.name] ?? 0) + 1;
    blocks.push({
      id,
      type: node.type.name,
      ordinal: blocks.length + 1,
      typeOrdinal: typeCounts[node.type.name],
      level: node.type.name === "heading" ? Number(node.attrs.level) : undefined,
      text: node.textContent,
      from: pos,
      to: pos + node.nodeSize,
      selected: selectionTouchesBlock(selection.from, selection.to, {
        from: pos,
        to: pos + node.nodeSize,
      }),
    });
  });

  const selectionText = selection.from === selection.to
    ? ""
    : doc.textBetween(selection.from, selection.to, "\n");
  const selectionContext: SelectionContext = {
    ...selection,
    text: selectionText,
    blockIds: blocks.filter((block) => block.selected).map((block) => block.id),
    revision,
  };

  return {
    schemaVersion: "1.0",
    revision,
    title: blocks.find((block) => block.type === "heading" && block.level === 1)?.text ?? "Untitled",
    plainText: doc.textBetween(0, doc.content.size, "\n\n"),
    blocks,
    selection: selectionContext,
  };
}

function selectBlocks(
  document: StructuredDocument,
  scope: DocumentReadScope,
  blockIds: string[],
) {
  if (scope === "selection") {
    return document.blocks.filter((block) => document.selection.blockIds.includes(block.id));
  }
  if (scope === "blocks") {
    const requested = new Set(blockIds);
    return document.blocks.filter((block) => requested.has(block.id));
  }
  return document.blocks;
}

function blockLabel(block: DocumentBlock) {
  return block.type === "paragraph"
    ? `paragraph_index="${block.typeOrdinal}"`
    : `heading_index="${block.typeOrdinal}" level="${block.level ?? 2}"`;
}

function serializeXml(document: StructuredDocument, blocks: DocumentBlock[], outline: boolean) {
  const selectionRefs = document.selection.blockIds
    .map((id) => `<block_ref id="${escapeXml(id)}" />`)
    .join("");
  const blockXml = blocks.map((block) => {
    const text = outline && block.text.length > 180 ? `${block.text.slice(0, 180)}…` : block.text;
    return `  <block id="${escapeXml(block.id)}" type="${block.type}" ordinal="${block.ordinal}" ${blockLabel(block)} selected="${block.selected}">${escapeXml(text)}</block>`;
  }).join("\n");

  return [
    `<document schema_version="${document.schemaVersion}" revision="${document.revision}" title="${escapeXml(document.title)}">`,
    `  <selection from="${document.selection.from}" to="${document.selection.to}"><text>${escapeXml(document.selection.text)}</text>${selectionRefs}</selection>`,
    blockXml,
    "</document>",
  ].join("\n");
}

function serializeMarkdown(document: StructuredDocument, blocks: DocumentBlock[], outline: boolean) {
  const selectionHeader = document.selection.blockIds.length > 0
    ? `<!-- selection: ${document.selection.blockIds.join(", ")} -->\n\n`
    : "";
  return selectionHeader + blocks.map((block) => {
    const text = outline && block.text.length > 180 ? `${block.text.slice(0, 180)}…` : block.text;
    const marker = `<!-- block_id: ${block.id}; ${block.type}_index: ${block.typeOrdinal}; selected: ${block.selected} -->`;
    const content = block.type === "heading" ? `${"#".repeat(block.level ?? 2)} ${text}` : text;
    return `${marker}\n${content}`;
  }).join("\n\n");
}

export function serializeDocument(
  document: StructuredDocument,
  format: DocumentReadFormat,
  scope: DocumentReadScope,
  blockIds: string[],
) {
  const blocks = selectBlocks(document, scope, blockIds);
  if (format === "json") {
    return JSON.stringify({
      ...document,
      blocks: blocks.map((block) => ({
        id: block.id,
        type: block.type,
        ordinal: block.ordinal,
        typeOrdinal: block.typeOrdinal,
        level: block.level,
        text: block.text,
        selected: block.selected,
      })),
    });
  }
  if (format === "markdown") return serializeMarkdown(document, blocks, scope === "outline");
  return serializeXml(document, blocks, scope === "outline");
}
