"use client";

import { useState } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  List,
  ListOrdered,
  AlignRight,
  AlignCenter,
  AlignLeft,
  AlignJustify,
} from "lucide-react";
import { cn } from "@/lib/utils";

function ToolbarButton({
  active,
  onClick,
  children,
  label,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "rounded-md p-1.5 text-ink-muted hover:bg-paper hover:text-ink",
        active && "bg-paper text-ink",
      )}
    >
      {children}
    </button>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-line p-1.5">
      <ToolbarButton
        label="ضخیم"
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="مورب"
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="زیرخط‌دار"
        active={editor.isActive("underline")}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <UnderlineIcon className="h-4 w-4" />
      </ToolbarButton>
      <span className="mx-1 h-4 w-px bg-line" />
      <ToolbarButton
        label="لیست نقطه‌ای"
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="لیست شماره‌دار"
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered className="h-4 w-4" />
      </ToolbarButton>
      <span className="mx-1 h-4 w-px bg-line" />
      <ToolbarButton
        label="راست‌چین"
        active={editor.isActive({ textAlign: "right" })}
        onClick={() => editor.chain().focus().setTextAlign("right").run()}
      >
        <AlignRight className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="وسط‌چین"
        active={editor.isActive({ textAlign: "center" })}
        onClick={() => editor.chain().focus().setTextAlign("center").run()}
      >
        <AlignCenter className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="چپ‌چین"
        active={editor.isActive({ textAlign: "left" })}
        onClick={() => editor.chain().focus().setTextAlign("left").run()}
      >
        <AlignLeft className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="بلوکی"
        active={editor.isActive({ textAlign: "justify" })}
        onClick={() => editor.chain().focus().setTextAlign("justify").run()}
      >
        <AlignJustify className="h-4 w-4" />
      </ToolbarButton>
    </div>
  );
}

/**
 * Rich-text editor for letter bodies. Renders visible Tiptap UI plus a
 * hidden input (kept in sync on every update) so it drops into a plain
 * <form action={serverAction}> exactly like JalaliDateInput does.
 */
export function RichTextEditor({
  name,
  defaultHTML,
}: {
  name: string;
  defaultHTML?: string | null;
}) {
  const [html, setHtml] = useState(defaultHTML || "");
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Underline,
      TextAlign.configure({ types: ["paragraph"], defaultAlignment: "right" }),
    ],
    content: defaultHTML || "",
    editorProps: {
      attributes: {
        dir: "rtl",
        class: "min-h-[10rem] px-3 py-2 text-sm leading-7 text-ink focus:outline-none",
      },
    },
    onUpdate: ({ editor }) => setHtml(editor.getHTML()),
  });

  if (!editor) return null;

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-white">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
      <input type="hidden" name={name} value={html} readOnly />
    </div>
  );
}
