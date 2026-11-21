"use client";

import { useRouter } from "next/navigation";
import { Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/common";
import { useAction } from "@/components/ui/use-action";
import { deleteAnnouncement, setAnnouncementPinned } from "./actions";
import { AnnouncementDialog } from "./announcement-dialog";

export function AnnouncementAdminActions({
  announcement,
}: {
  announcement: { id: string; title: string; content: string; category: string; pinned: boolean };
}) {
  const router = useRouter();
  const { run } = useAction();
  return (
    <>
      <Button
        variant="ghost"
        onClick={() =>
          run(() => setAnnouncementPinned(announcement.id, !announcement.pinned), {
            success: announcement.pinned ? "已取消置顶" : "已置顶",
          })
        }
      >
        {announcement.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
        {announcement.pinned ? "取消置顶" : "置顶"}
      </Button>
      <AnnouncementDialog initial={announcement}>
        <Button>
          <Pencil className="size-3.5" />
          编辑
        </Button>
      </AnnouncementDialog>
      <ConfirmButton
        danger
        title="删除公告"
        description="删除后所有成员将无法查看该公告，且不可恢复。"
        confirmText="删除"
        onConfirm={() =>
          run(() => deleteAnnouncement(announcement.id), {
            success: "公告已删除",
            refresh: false,
            onSuccess: () => router.push("/oa/announcements"),
          })
        }
      >
        <Trash2 className="size-3.5" />
        删除
      </ConfirmButton>
    </>
  );
}
