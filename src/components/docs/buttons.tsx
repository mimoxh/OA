"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { FolderPlus, Palette, Plus, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAction } from "@/components/ui/use-action";
import { createDatabase, createDocument, createWhiteboard } from "@/app/(app)/docs/actions";
import { SpaceFormDialog } from "./space-dialog";

export function NewPageButton({
  spaceId,
  parentId,
  template,
  templateDocId,
  variant = "primary",
  className,
  children,
}: {
  spaceId: string;
  parentId?: string;
  template?: string;
  templateDocId?: string;
  variant?: "primary" | "default" | "ghost" | "subtle";
  className?: string;
  children?: ReactNode;
}) {
  const router = useRouter();
  const { run, pending } = useAction();
  return (
    <Button
      variant={variant}
      className={className}
      loading={pending}
      onClick={() =>
        run(() => createDocument({ spaceId, parentId, template, templateDocId }), {
          onSuccess: (d) => router.push(`/docs/${d.id}`),
        })
      }
    >
      {children ?? (
        <>
          {!pending && <Plus className="size-3.5" />}
          新建页面
        </>
      )}
    </Button>
  );
}

export function NewDatabaseButton({
  spaceId,
  parentId,
  variant = "default",
  className,
}: {
  spaceId: string;
  parentId?: string;
  variant?: "primary" | "default" | "ghost" | "subtle";
  className?: string;
}) {
  const router = useRouter();
  const { run, pending } = useAction();
  return (
    <Button
      variant={variant}
      className={className}
      loading={pending}
      onClick={() =>
        run(() => createDatabase({ spaceId, parentId }), {
          onSuccess: (d) => router.push(`/docs/${d.id}`),
        })
      }
    >
      {!pending && <Table2 className="size-3.5" />}
      新建多维表格
    </Button>
  );
}

export function NewWhiteboardButton({ spaceId }: { spaceId: string }) {
  const router = useRouter();
  const { run, pending } = useAction();
  return <Button
    loading={pending}
    onClick={() => void run(() => createWhiteboard({ spaceId }), { onSuccess: (board) => router.push(`/docs/${board.id}`) })}
  >
    {!pending && <Palette className="size-3.5" />}
    新建白板
  </Button>;
}

export function NewSpaceButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <FolderPlus className="size-3.5" />
        新建空间
      </Button>
      <SpaceFormDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
