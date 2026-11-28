"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button, IconButton } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { useIsMobileLayout } from "@/components/mobile/use-mobile-layout";
import { useAction } from "@/components/ui/use-action";
import { formatDateTime, formatRelative } from "@/lib/format";
import { addApprovalComment, deleteApprovalComment } from "../actions";

export type CommentItem = {
  id: string;
  content: string;
  createdAt: string;
  author: { id: string; name: string; avatarColor: string };
};

export function ApprovalComments({
  instanceId,
  comments,
  me,
  canModerate,
}: {
  instanceId: string;
  comments: CommentItem[];
  me: { id: string; name: string; avatarColor: string };
  canModerate: boolean;
}) {
  const { run, pending } = useAction();
  const mobile = useIsMobileLayout();
  const [content, setContent] = useState("");

  const submit = () => {
    if (!content.trim()) return;
    run(() => addApprovalComment({ instanceId, content }), { onSuccess: () => setContent("") });
  };

  return (
    <div>
      <div className="space-y-4">
        {comments.length === 0 && <p className="text-[13px] text-ink-3">还没有评论，可以在这里与申请人、审批人沟通。</p>}
        {comments.map((c) => (
          <div key={c.id} className="group flex gap-2.5">
            <Avatar name={c.author.name} color={c.author.avatarColor} size={26} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[13px]">
                <span className="font-medium text-ink">{c.author.name}</span>
                <span className="text-xs text-ink-3" title={formatDateTime(c.createdAt)}>
                  {formatRelative(c.createdAt)}
                </span>
                {(c.author.id === me.id || canModerate) && (
                  <IconButton
                    aria-label="删除评论"
                    className="opacity-0 group-hover:opacity-100 pointer-coarse:size-8 pointer-coarse:opacity-100"
                    onClick={() => run(() => deleteApprovalComment(c.id), { success: "评论已删除" })}
                  >
                    <Trash2 className="size-3.5" />
                  </IconButton>
                )}
              </div>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-ink">{c.content}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-5 flex gap-2.5">
        <Avatar name={me.name} color={me.avatarColor} size={26} />
        <div className="flex-1">
          <Textarea
            rows={2}
            value={content}
            maxLength={2000}
            onChange={(e) => setContent(e.target.value)}
            placeholder={mobile ? "添加评论…" : "添加评论… （Ctrl + Enter 发送）"}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
            }}
          />
          <div className="mt-2 flex justify-end">
            <Button variant="primary" loading={pending} disabled={!content.trim()} onClick={submit} className="max-md:h-9 max-md:px-4">
              发送
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
