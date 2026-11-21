"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type ProductOption = { id: string; sku: string; name: string; unit: string };
export type Line = { key: string; productId: string; quantity: string };

let seq = 0;
export function newLine(): Line {
  seq += 1;
  return { key: `line-${seq}`, productId: "", quantity: "1" };
}

/** 产品明细行编辑器；available 传入时显示可用库存并只列出有库存的产品 */
export function ItemLines({
  products,
  lines,
  onChange,
  available,
}: {
  products: ProductOption[];
  lines: Line[];
  onChange: (lines: Line[]) => void;
  available?: Record<string, number>;
}) {
  const update = (key: string, patch: Partial<Line>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const options = available ? products.filter((p) => (available[p.id] ?? 0) > 0) : products;
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-[1fr_96px_88px_24px] gap-2 text-xs text-ink-2">
        <span>产品</span>
        <span>数量</span>
        <span>{available ? "可用库存" : "单位"}</span>
        <span />
      </div>
      {lines.map((l) => {
        const p = products.find((x) => x.id === l.productId);
        const avail = available && l.productId ? (available[l.productId] ?? 0) : undefined;
        const over = avail !== undefined && Number(l.quantity) > avail;
        return (
          <div key={l.key} className="grid grid-cols-[1fr_96px_88px_24px] items-center gap-2">
            <Select value={l.productId} onChange={(e) => update(l.key, { productId: e.target.value })}>
              <option value="">选择产品…</option>
              {options.map((o) => (
                <option key={o.id} value={o.id} disabled={lines.some((x) => x.key !== l.key && x.productId === o.id)}>
                  {o.sku} · {o.name}
                </option>
              ))}
            </Select>
            <Input
              type="number"
              min={1}
              step={1}
              value={l.quantity}
              onChange={(e) => update(l.key, { quantity: e.target.value })}
              className={cn("tabular-nums", over && "border-danger")}
            />
            <span className={cn("text-[13px] tabular-nums", over ? "text-danger" : "text-ink-2")}>
              {avail !== undefined ? `${avail} ${p?.unit ?? ""}` : (p?.unit ?? "—")}
            </span>
            <IconButton onClick={() => onChange(lines.filter((x) => x.key !== l.key))} disabled={lines.length <= 1} aria-label="删除行">
              <Trash2 className="size-3.5" />
            </IconButton>
          </div>
        );
      })}
      <Button variant="ghost" size="xs" onClick={() => onChange([...lines, newLine()])}>
        <Plus className="size-3.5" />
        添加产品
      </Button>
    </div>
  );
}
