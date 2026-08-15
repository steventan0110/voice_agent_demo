"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";
import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Italic, List, ListOrdered, Redo2, Undo2 } from "lucide-react";
import { buildStructuredDocument } from "@/lib/document-model";
import { ensureStableBlockIds, StableBlockId } from "@/lib/stable-block-id";
import type {
  DocumentPatchOperation,
  SelectionContext,
  StructuredDocument,
} from "@/lib/workspace-types";

export type DocumentEditorHandle = {
  applyPatchOperations: (operations: DocumentPatchOperation[]) => boolean;
  readDocument: () => StructuredDocument | null;
};

type DocumentEditorProps = {
  revision: number;
  onSelectionChange: (selection: SelectionContext) => void;
  onDocumentChange: (document: StructuredDocument) => void;
};

export const INITIAL_DOCUMENT_HTML = `
  <h1 data-block-id="prd-title">语音协作工作台 PRD</h1>
  <p data-block-id="prd-summary">我们想做一个能陪用户边写边想的 AI 工作台，它一直听着讨论、理解文档，也会把想到的东西放到右侧，但整个体验需要自然、及时，而且不要打断用户。</p>

  <h2 data-block-id="prd-experience-heading">一、核心体验</h2>
  <p data-block-id="prd-experience">用户选中一句话后直接说“把这段写得更明确”。助手读取选区，生成可审阅的修改；用户再用语音接受、拒绝或继续调整。</p>

  <h2 data-block-id="prd-flow-heading">二、协作流程</h2>
  <p data-block-id="prd-flow">助手先判断请求能否实时完成：短改写直接生成补丁；研究、复杂图表或原型进入后台任务；所有结果最终回到文档或 Canvas 等待用户审阅。</p>

  <h2 data-block-id="prd-delegation-heading">三、并行任务</h2>
  <p data-block-id="prd-delegation">同一句指令可以拆成多个互不依赖的任务，例如把“协作流程”画成 Mermaid，同时润色“核心体验”。两个任务应该并行开始，而不是先后执行。</p>
  <blockquote><p data-block-id="prd-delegation-todo">【待补充】任务被取消、调整方向，或与用户的新编辑发生冲突时，系统应该如何处理？</p></blockquote>

  <h2 data-block-id="prd-metrics-heading">四、成功指标</h2>
  <blockquote><p data-block-id="prd-metrics-todo">【待补充】请定义 3 个能够衡量文档理解、建议质量和语音连续性的核心指标。</p></blockquote>
`;

export const DocumentEditor = forwardRef<DocumentEditorHandle, DocumentEditorProps>(
  function DocumentEditor({ revision, onSelectionChange, onDocumentChange }, ref) {
    const revisionRef = useRef(revision);
    revisionRef.current = Math.max(revisionRef.current, revision);

    const editor = useEditor({
      immediatelyRender: false,
      extensions: [
        StarterKit,
        StableBlockId,
        Placeholder.configure({
          placeholder: "开始写作，或选中任意内容后直接用语音讨论…",
        }),
      ],
      content: INITIAL_DOCUMENT_HTML,
      editorProps: {
        attributes: {
          class: "document-editor__content",
          "aria-label": "可编辑的产品需求文档",
        },
      },
      onCreate: ({ editor: activeEditor }) => {
        ensureStableBlockIds(activeEditor);
        const snapshot = buildStructuredDocument(
          activeEditor.state.doc,
          activeEditor.state.selection,
          revisionRef.current,
        );
        onDocumentChange(snapshot);
        onSelectionChange(snapshot.selection);
      },
      onSelectionUpdate: ({ editor: activeEditor }) => {
        const snapshot = buildStructuredDocument(
          activeEditor.state.doc,
          activeEditor.state.selection,
          revisionRef.current,
        );
        onSelectionChange(snapshot.selection);
      },
      onUpdate: ({ editor: activeEditor, transaction }) => {
        ensureStableBlockIds(activeEditor);
        if (!transaction.getMeta("stableBlockIds")) revisionRef.current += 1;

        const snapshot = buildStructuredDocument(
          activeEditor.state.doc,
          activeEditor.state.selection,
          revisionRef.current,
        );
        onDocumentChange(snapshot);
        onSelectionChange(snapshot.selection);
      },
    });

    useImperativeHandle(
      ref,
      () => ({
        applyPatchOperations(operations) {
          if (!editor || operations.length === 0) return false;
          const transaction = editor.state.tr;
          [...operations]
            .sort((a, b) => b.from - a.from)
            .forEach((operation) => {
              transaction.insertText(operation.replacementText, operation.from, operation.to);
            });
          editor.view.dispatch(transaction);
          editor.commands.focus();
          return true;
        },
        readDocument() {
          if (!editor) return null;
          return buildStructuredDocument(
            editor.state.doc,
            editor.state.selection,
            revisionRef.current,
          );
        },
      }),
      [editor],
    );

    return (
      <section className="document-editor">
        <div className="document-editor__toolbar" aria-label="文档格式工具">
          <button type="button" aria-label="撤销" onClick={() => editor?.chain().focus().undo().run()}>
            <Undo2 aria-hidden="true" />
          </button>
          <button type="button" aria-label="重做" onClick={() => editor?.chain().focus().redo().run()}>
            <Redo2 aria-hidden="true" />
          </button>
          <span className="document-editor__divider" />
          <button
            type="button"
            aria-label="粗体"
            data-active={editor?.isActive("bold") || undefined}
            onClick={() => editor?.chain().focus().toggleBold().run()}
          >
            <Bold aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="斜体"
            data-active={editor?.isActive("italic") || undefined}
            onClick={() => editor?.chain().focus().toggleItalic().run()}
          >
            <Italic aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="项目符号列表"
            data-active={editor?.isActive("bulletList") || undefined}
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
          >
            <List aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="编号列表"
            data-active={editor?.isActive("orderedList") || undefined}
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered aria-hidden="true" />
          </button>
        </div>
        <div className="document-editor__paper">
          <div className="document-editor__meta">产品草案 · Revision {revision} · 支持语音引用段落</div>
          <EditorContent editor={editor} />
        </div>
      </section>
    );
  },
);
