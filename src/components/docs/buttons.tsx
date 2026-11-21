"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { FolderPlus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAction } from "@/components/ui/use-action";
import { createDocument } from "@/app/(app)/docs/actions";
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
