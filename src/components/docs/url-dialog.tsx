"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export function UrlDialog({
  open,
  onOpenChange,
  title,
  description,
  placeholder,
  onSubmit,
  extra,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  placeholder?: string;
  onSubmit: (url: string) => void;
  extra?: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <Body title={title} description={description} placeholder={placeholder} onSubmit={onSubmit} onCancel={() => onOpenChange(false)} extra={extra} />
      )}
    </Dialog>
  );
}

function Body({
  title,
  description,
  placeholder,
  onSubmit,
  onCancel,
  extra,
}: {
  title: string;
  description?: string;
  placeholder?: string;
  onSubmit: (url: string) => void;
  onCancel: () => void;
  extra?: ReactNode;
}) {
  const [v, setV] = useState("");
  const valid = /^https?:\/\/\S+$/.test(v.trim());
  return (
    <DialogContent
      size="sm"
      title={title}
      description={description}
      footer={
        <>
          <Button onClick={onCancel}>取消</Button>
          <Button variant="primary" disabled={!valid} onClick={() => onSubmit(v.trim())}>
            确定
          </Button>
        </>
      }
    >
      <form
        className="pb-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onSubmit(v.trim());
        }}
      >
        <Input autoFocus value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder ?? "https://"} />
        {v && !valid && <p className="mt-1 text-xs text-danger">请输入以 http:// 或 https:// 开头的链接</p>}
      </form>
      {extra}
    </DialogContent>
  );
}
