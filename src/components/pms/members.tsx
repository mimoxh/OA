"use client";

import { useState } from "react";
import { Trash2, UserPlus } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useAction } from "@/components/ui/use-action";
import { PROJECT_MEMBER_ROLE } from "@/lib/pms/utils";
import type { UserOption } from "@/lib/crm/types";
import { addProjectMember, removeProjectMember, updateProjectMember } from "@/app/(app)/pms/actions";

export type MemberRow = {
  id: string;
  role: string;
  user: { id: string; name: string; avatarColor: string; title: string | null; email: string };
  open: number;
  done: number;
  hours: number;
};

export function Members({
  projectId,
  ownerId,
  members,
  users,
  canManage,
}: {
  projectId: string;
  ownerId: string;
  members: MemberRow[];
  users: UserOption[];
  canManage: boolean;
}) {
  const { run, pending } = useAction();
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState("member");
  const candidates = users.filter((u) => !members.some((m) => m.user.id === u.id));
  return (
    <div>
      {canManage && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-sidebar p-3">
          <UserPlus className="size-4 text-ink-3" />
          <Select value={userId} onChange={(e) => setUserId(e.target.value)} className="h-7 w-48 text-[13px]">
            <option value="">选择要添加的成员</option>
            {candidates.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
          <Select value={role} onChange={(e) => setRole(e.target.value)} className="h-7 w-28 text-[13px]">
            <option value="member">成员</option>
            <option value="viewer">观察者</option>
            <option value="owner">负责人</option>
          </Select>
          <Button
            size="sm"
            variant="primary"
            disabled={!userId}
            loading={pending}
            onClick={() => run(() => addProjectMember(projectId, userId, role), { success: "成员已添加", onSuccess: () => setUserId("") })}
          >
            添加
          </Button>
          <span className="ml-auto text-xs text-ink-3">成员可编辑任务；观察者只读</span>
        </div>
      )}
      <Table>
        <THead>
          <TR>
            <TH>成员</TH>
            <TH>角色</TH>
            <TH className="text-right">进行中任务</TH>
            <TH className="text-right">已完成</TH>
            <TH className="text-right">登记工时</TH>
            <TH className="w-10" />
          </TR>
        </THead>
        <TBody>
          {members.map((m) => (
            <TR key={m.id}>
              <TD>
                <span className="flex items-center gap-2">
                  <Avatar name={m.user.name} color={m.user.avatarColor} size={26} />
                  <span>
                    <span className="block font-medium leading-tight">{m.user.name}</span>
                    <span className="block text-xs text-ink-3">{m.user.title ?? m.user.email}</span>
                  </span>
                </span>
              </TD>
              <TD>
                {canManage && m.user.id !== ownerId ? (
                  <Select
                    value={m.role}
                    onChange={(e) => run(() => updateProjectMember(m.id, e.target.value), { success: "角色已更新" })}
                    className="h-7 w-28 text-[13px]"
                  >
                    {Object.entries(PROJECT_MEMBER_ROLE).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Badge color={m.role === "owner" ? "orange" : m.role === "viewer" ? "gray" : "blue"}>{PROJECT_MEMBER_ROLE[m.role] ?? m.role}</Badge>
                )}
              </TD>
              <TD className="text-right tabular-nums">{m.open}</TD>
              <TD className="text-right tabular-nums text-ink-2">{m.done}</TD>
              <TD className="text-right tabular-nums text-ink-2">{m.hours} h</TD>
              <TD>
                {canManage && m.user.id !== ownerId && (
                  <IconButton aria-label="移除成员" onClick={() => run(() => removeProjectMember(m.id), { success: "已移除成员" })}>
                    <Trash2 className="size-3.5" />
                  </IconButton>
                )}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
