"use client";

import { Plus, Trash2, TriangleAlert } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { formatMoney, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

export type LineProduct = { id: string; sku: string; name: string; unit: string; defaultPrice: number; active: boolean };
export type LineDraft = { key: string; productId: string; quantity: string; price: string };

let seq = 0;
export function newLine(partial: Partial<LineDraft> = {}): LineDraft {
  seq += 1;
  return { key: `l${Date.now()}-${seq}`, productId: "", quantity: "1", price: "", ...partial };
}

export function lineAmount(l: LineDraft) {
  const q = Number(l.quantity);
  const p = Number(l.price);
  return Number.isFinite(q) && Number.isFinite(p) ? Math.round(q * p * 100) / 100 : 0;
}

export function linesTotal(lines: LineDraft[]) {
  return Math.round(lines.reduce((s, l) => s + lineAmount(l), 0) * 100) / 100;
}

/** 单据明细行编辑器：选择产品、数量、单价，行小计与合计；可选显示可用库存 */
export function LineItemsEditor({
  products,
  lines,
  onChange,
  stock,
  priceLabel = "单价",
}: {
  products: LineProduct[];
  lines: LineDraft[];
  onChange: (lines: LineDraft[]) => void;
  /** productId → 所选仓库可用库存；不传则不显示库存列 */
  stock?: Record<string, number> | null;
  priceLabel?: string;
}) {
  const byId = new Map(products.map((p) => [p.id, p]));
  const update = (key: string, patch: Partial<LineDraft>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const showStock = stock !== undefined;

  return (
    <div className="rounded-lg border border-line">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line bg-sidebar/60 text-left text-xs text-ink-2">
            <th className="w-10 px-3 py-2 font-normal">#</th>
            <th className="px-2 py-2 font-normal">产品</th>
            <th className="w-14 px-2 py-2 font-normal">单位</th>
            {showStock && <th className="w-24 px-2 py-2 text-right font-normal">可用库存</th>}
            <th className="w-28 px-2 py-2 font-normal">数量</th>
            <th className="w-32 px-2 py-2 font-normal">{priceLabel}</th>
            <th className="w-32 px-2 py-2 text-right font-normal">小计</th>
            <th className="w-10 px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const p = byId.get(l.productId);
            const avail = p && stock ? (stock[p.id] ?? 0) : null;
            const qty = Number(l.quantity) || 0;
            const short = avail !== null && qty > avail;
            const used = new Set(lines.filter((x) => x.key !== l.key).map((x) => x.productId));
            return (
              <tr key={l.key} className="border-b border-line last:border-b-0">
                <td className="px-3 py-1.5 text-xs text-ink-3">{i + 1}</td>
                <td className="px-2 py-1.5">
                  <Select
                    value={l.productId}
                    onChange={(e) => {
                      const np = byId.get(e.target.value);
                      update(l.key, { productId: e.target.value, price: np ? String(np.defaultPrice) : l.price });
                    }}
                    className={cn(!l.productId && "text-ink-3")}
                  >
                    <option value="">选择产品…</option>
                    {products
                      .filter((x) => x.active || x.id === l.productId)
                      .map((x) => (
                        <option key={x.id} value={x.id} disabled={used.has(x.id)}>
                          {x.sku} · {x.name}
                        </option>
                      ))}
                  </Select>
                </td>
                <td className="px-2 py-1.5 text-ink-2">{p?.unit ?? "—"}</td>
                {showStock && (
                  <td className={cn("px-2 py-1.5 text-right tabular-nums", short ? "text-danger" : "text-ink-2")}>
                    {avail === null ? "—" : formatNumber(avail)}
                  </td>
                )}
                <td className="px-2 py-1.5">
                  <Input
                    type="number"
                    min="1"
                    step="1"
                    value={l.quantity}
                    onChange={(e) => update(l.key, { quantity: e.target.value })}
                    className={cn("tabular-nums", short && "border-danger")}
                  />
                  {short && (
                    <div className="mt-0.5 flex items-center gap-1 text-[11px] text-danger">
                      <TriangleAlert className="size-3" />
                      库存不足，缺 {formatNumber(qty - (avail ?? 0))}
                    </div>
                  )}
                </td>
                <td className="px-2 py-1.5">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={l.price}
                    onChange={(e) => update(l.key, { price: e.target.value })}
                    className="tabular-nums"
                  />
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">{formatMoney(lineAmount(l))}</td>
                <td className="px-2 py-1.5 text-center">
                  <IconButton
                    aria-label="删除行"
                    title="删除行"
                    disabled={lines.length <= 1}
                    onClick={() => onChange(lines.filter((x) => x.key !== l.key))}
                  >
                    <Trash2 className="size-3.5" />
                  </IconButton>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex items-center justify-between border-t border-line bg-sidebar/40 px-3 py-2">
        <Button variant="ghost" size="sm" onClick={() => onChange([...lines, newLine()])}>
          <Plus className="size-3.5" />
          添加一行
        </Button>
        <div className="text-sm text-ink-2">
          共 {lines.filter((l) => l.productId).length} 种产品，合计
          <span className="ml-2 text-base font-semibold tabular-nums text-ink">{formatMoney(linesTotal(lines))}</span>
        </div>
      </div>
    </div>
  );
}

export function serializeLines(lines: LineDraft[]) {
  return lines
    .filter((l) => l.productId || l.quantity.trim() !== "1" || l.price.trim() !== "")
    .map((l) => ({ productId: l.productId, quantity: Number(l.quantity), price: Number(l.price || 0) }));
}
