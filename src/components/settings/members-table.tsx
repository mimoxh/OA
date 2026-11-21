"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TEmpty, TH, THead, TR } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { MemberDialog, type DeptOption, type MemberRow, type RoleOption } from "./member-dialogs";

export function MembersTable({
  members,
  selected,
  departments,
  roles,
  meId,
}: {
  members: MemberRow[];
  selected: MemberRow | null;
  departments: DeptOption[];
  roles: RoleOption[];
  meId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [openId, setOpenId] = useState<string | null>(selected?.id ?? null);
  const [prevSelected, setPrevSelected] = useState(selected?.id);
  if (selected?.id !== prevSelected) {
    setPrevSelected(selected?.id);
    if (selected?.id) setOpenId(selected.id);
  }
  const current = openId ? (members.find((m) => m.id === openId) ?? (selected?.id === openId ? selected : null)) : null;

  const setUrl = (id: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (id) next.set("user", id);
    else next.delete("user");
    router.replace(`${pathname}${next.toString() ? `?${next}` : ""}`, { scroll: false });
  };

  return (
    <>
      <Table>
        <THead>
          <TR>
            <TH>成员</TH>
            <TH>部门</TH>
            <TH>角色</TH>
            <TH>职位</TH>
            <TH>手机</TH>
            <TH>状态</TH>
          </TR>
        </THead>
        <TBody>
          {members.length === 0 && <TEmpty colSpan={6}>没有符合条件的成员</TEmpty>}
          {members.map((m) => (
            <TR
              key={m.id}
              onClick={() => {
                setOpenId(m.id);
                setUrl(m.id);
              }}
              className={cn("cursor-pointer", !m.active && "opacity-60")}
            >
              <TD>
                <span className="flex items-center gap-2.5 py-0.5">
                  <Avatar name={m.name} color={m.avatarColor} size={28} />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 font-medium">
                      {m.name}
                      {m.id === meId && <Badge color="blue">我</Badge>}
                    </span>
                    <span className="block truncate text-xs text-ink-3">{m.email}</span>
                  </span>
                </span>
              </TD>
              <TD className="text-ink-2">{m.departmentName ?? "—"}</TD>
              <TD>
                <Badge color={m.roleName === "系统管理员" ? "purple" : "gray"}>{m.roleName}</Badge>
              </TD>
              <TD className="text-ink-2">{m.title ?? "—"}</TD>
              <TD className="tabular-nums text-ink-2">{m.phone ?? "—"}</TD>
              <TD>{m.active ? <Badge color="green">正常</Badge> : <Badge color="red">已停用</Badge>}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
      {current && (
        <MemberDialog
          key={current.id}
          member={current}
          departments={departments}
          roles={roles}
          meId={meId}
          onClose={() => {
            setOpenId(null);
            setUrl(null);
          }}
        />
      )}
    </>
  );
}
