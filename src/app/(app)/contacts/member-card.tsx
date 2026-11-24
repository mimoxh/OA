"use client";

import type { ReactNode } from "react";
import { MessageSquare } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { LinkButton } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Properties, Property } from "@/components/ui/page";

export type ContactMember = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  title: string | null;
  avatarColor: string;
  departmentName: string | null;
  roleName: string;
  isBot?: boolean;
  description?: string | null;
};

export function MemberCard({ member, children }: { member: ContactMember; children: ReactNode }) {
  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent
        size="sm"
        title={member.name}
        description={[member.title, member.departmentName].filter(Boolean).join(" · ") || undefined}
        footer={
          <LinkButton variant="primary" size="md" href={`/messages?to=${member.id}`}>
            <MessageSquare className="size-4" />
            发消息
          </LinkButton>
        }
      >
        <div className="flex items-center gap-3 py-2">
          <Avatar name={member.name} color={member.avatarColor} size={48} />
          <div className="min-w-0">
            <div className="truncate text-[15px] font-medium text-ink">{member.name}</div>
            <div className="truncate text-[13px] text-ink-3">{member.roleName}</div>
          </div>
        </div>
        {member.isBot ? (
          <Properties>
            <Property label="类型">Webhook 机器人</Property>
            <Property label="简介">{member.description || "—"}</Property>
            <Property label="说明">单聊消息或群聊中 @ 它时，消息会转发给外部服务并由其自动回复</Property>
          </Properties>
        ) : (
          <Properties>
            <Property label="部门">{member.departmentName ?? "—"}</Property>
            <Property label="职位">{member.title ?? "—"}</Property>
            <Property label="邮箱">{member.email}</Property>
            <Property label="电话">{member.phone ?? "—"}</Property>
          </Properties>
        )}
      </DialogContent>
    </Dialog>
  );
}
