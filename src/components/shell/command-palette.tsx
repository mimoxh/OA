"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { Dialog as D } from "radix-ui";
import { CornerDownLeft, FileText, Loader2, Search } from "lucide-react";
import { NAV_MODULES } from "@/lib/nav";
import { hasPermission } from "@/lib/permissions";

export type SearchHit = { type: string; group: string; id: string; title: string; subtitle?: string; href: string; icon?: string };

const OPEN_EVENT = "command-palette:open";
export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

export function CommandPalette({ permissions }: { permissions: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    if (!q.trim()) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      setLoading(true);
      fetch(`/api/search?q=${encodeURIComponent(q.trim())}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((d) => setHits(d.results ?? []))
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 180);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  const go = (href: string) => {
    setOpen(false);
    setQ("");
    router.push(href);
  };

  const groups = (q.trim() ? hits : []).reduce<Record<string, SearchHit[]>>((acc, h) => {
    (acc[h.group] ??= []).push(h);
    return acc;
  }, {});

  const pages = NAV_MODULES.filter((m) => hasPermission(permissions, m.perm)).flatMap((m) =>
    m.items
      .filter((i) => !i.perm || hasPermission(permissions, i.perm))
      .map((i) => ({ ...i, module: m.label, color: m.color, Icon: m.icon })),
  );

  return (
    <D.Root open={open} onOpenChange={setOpen}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/25 animate-fade-in" />
        <D.Content className="fixed left-1/2 top-[14vh] z-50 w-[calc(100vw-2rem)] max-w-[640px] -translate-x-1/2 overflow-hidden rounded-xl bg-white shadow-pop animate-pop-in">
          <D.Title className="sr-only">全局搜索</D.Title>
          <D.Description className="sr-only">搜索文档、客户、订单、项目等</D.Description>
          <Command shouldFilter={false} loop className="flex flex-col">
            <div className="flex items-center gap-2 border-b border-line px-4">
              {loading ? <Loader2 className="size-4 animate-spin text-ink-3" /> : <Search className="size-4 text-ink-3" />}
              <Command.Input
                value={q}
                onValueChange={setQ}
                placeholder="搜索文档、客户、订单、项目、任务…"
                className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-ink-3"
              />
            </div>
            <Command.List className="max-h-[420px] overflow-y-auto p-1.5 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-ink-3">
              {q.trim() && !loading && Object.keys(groups).length === 0 && (
                <Command.Empty className="py-10 text-center text-sm text-ink-3">没有找到「{q}」相关结果</Command.Empty>
              )}
              {Object.entries(groups).map(([group, items]) => (
                <Command.Group key={group} heading={group}>
                  {items.map((h) => (
                    <Command.Item
                      key={h.type + h.id}
                      value={h.type + h.id}
                      onSelect={() => go(h.href)}
                      className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm data-[selected=true]:bg-hover"
                    >
                      <span className="flex size-5 items-center justify-center text-base">
                        {h.icon ?? <FileText className="size-4 text-ink-3" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-ink">{h.title || "无标题"}</span>
                        {h.subtitle && <span className="block truncate text-xs text-ink-3">{h.subtitle}</span>}
                      </span>
                      <CornerDownLeft className="size-3.5 text-ink-3 opacity-0 [[data-selected=true]_&]:opacity-100" />
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
              {!q.trim() && (
                <Command.Group heading="跳转到">
                  {pages.map((p) => (
                    <Command.Item
                      key={p.href}
                      value={p.href}
                      onSelect={() => go(p.href)}
                      className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm data-[selected=true]:bg-hover"
                    >
                      <p.Icon className="size-4" style={{ color: p.color }} />
                      <span className="text-ink">{p.label}</span>
                      <span className="text-xs text-ink-3">{p.module}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
            </Command.List>
          </Command>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
