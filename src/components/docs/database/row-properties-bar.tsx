"use client";

import { useState } from "react";
import Link from "next/link";
import { Table2 } from "lucide-react";
import { toast } from "sonner";
import { activeProperties } from "@/lib/docs/database/engine";
import type {
  DatabaseRow,
  PersonOption,
  PropertyDefinition,
  PropertyValue,
  TargetDatabaseSummary,
} from "@/lib/docs/database/types";
import { DatabaseCell, PropertyTypeIcon } from "./cells";

export interface RowPropertiesContext {
  databaseId: string;
  databaseTitle: string;
  databaseIcon: string | null;
  properties: PropertyDefinition[];
  row: DatabaseRow;
  members: PersonOption[];
  relatedDatabases: Record<string, TargetDatabaseSummary>;
  canWrite: boolean;
}

export function RowPropertiesBar({ initial }: { initial: RowPropertiesContext }) {
  const [row, setRow] = useState<DatabaseRow>(initial.row);
  const fields = activeProperties(initial.properties).filter((p) => p.type !== "title");

  const updateProp = async (propertyId: string, value: PropertyValue | null) => {
    try {
      const res = await fetch(`/api/docs/databases/${initial.databaseId}/rows/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ properties: { [propertyId]: value } }),
      });
      const data = (await res.json()) as { row?: DatabaseRow; error?: string };
      if (!res.ok || !data.row) throw new Error(data.error ?? "更新属性失败");
      setRow(data.row);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "更新属性失败");
    }
  };

  const updateRel = async (propertyId: string, add: string[], remove: string[]) => {
    try {
      const res = await fetch(
        `/api/docs/databases/${initial.databaseId}/rows/${row.id}/relations/${propertyId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ add, remove }),
        },
      );
      const data = (await res.json()) as { row?: DatabaseRow; error?: string };
      if (!res.ok || !data.row) throw new Error(data.error ?? "更新关联失败");
      setRow(data.row);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "更新关联失败");
    }
  };

  return (
    <div className="mb-6 rounded-lg border border-line bg-sidebar/40 px-4 py-3">
      <div className="mb-2 flex items-center justify-between text-xs text-ink-3">
        <Link
          href={`/docs/${initial.databaseId}`}
          className="inline-flex items-center gap-1.5 font-medium text-ink-2 hover:text-accent"
        >
          <Table2 className="size-3.5" />
          <span>{initial.databaseIcon || "🗃️"}</span>
          <span>所属多维表格：{initial.databaseTitle || "未命名多维表格"}</span>
        </Link>
        <span>{fields.length} 个属性</span>
      </div>
      <div className="divide-y divide-line/50">
        {fields.map((def) => (
          <div key={def.id} className="grid grid-cols-[120px_1fr] items-center gap-3 py-1.5">
            <div className="flex items-center gap-1.5 text-xs text-ink-3">
              <PropertyTypeIcon type={def.type} className="size-3.5 shrink-0" />
              <span className="truncate">{def.name}</span>
            </div>
            <div className="min-w-0">
              <DatabaseCell
                row={row}
                def={def}
                members={initial.members}
                relatedDatabases={initial.relatedDatabases}
                canWrite={initial.canWrite}
                onUpdateProperty={updateProp}
                onUpdateRelation={updateRel}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
