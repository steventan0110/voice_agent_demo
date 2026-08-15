import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/react";

const TRACKED_BLOCKS = ["heading", "paragraph"];

function newBlockId(type: string) {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${type}-${suffix}`;
}

export const StableBlockId = Extension.create({
  name: "stableBlockId",

  addGlobalAttributes() {
    return [{
      types: TRACKED_BLOCKS,
      attributes: {
        blockId: {
          default: null,
          parseHTML: (element) => element.getAttribute("data-block-id"),
          renderHTML: (attributes) => attributes.blockId
            ? { "data-block-id": attributes.blockId as string }
            : {},
        },
      },
    }];
  },
});

export function ensureStableBlockIds(editor: Editor) {
  const transaction = editor.state.tr;
  let changed = false;

  editor.state.doc.descendants((node, pos) => {
    if (!TRACKED_BLOCKS.includes(node.type.name) || node.attrs.blockId) return;
    transaction.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      blockId: newBlockId(node.type.name),
    });
    changed = true;
  });

  if (changed) {
    transaction.setMeta("addToHistory", false);
    transaction.setMeta("stableBlockIds", true);
    editor.view.dispatch(transaction);
  }

  return changed;
}
