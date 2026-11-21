"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Flag, Plus, Send, Trash2 } from "lucide-react";
import type { ApprovalStep, FormField } from "@/lib/services/approval";
import { FIELD_TYPE_LABELS, type FormValues } from "@/lib/oa/form";
import { FLOW_CATEGORIES, type MemberOption } from "@/lib/oa/types";
import { Button, IconButton, LinkButton } from "@/components/ui/button";
import { Checkbox, Field, Input, Label, Select, Textarea } from "@/components/ui/input";
import { ConfirmButton } from "@/components/ui/common";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/page";
import { useAction } from "@/components/ui/use-action";
import { DynamicFormFields } from "@/components/oa/dynamic-form";
import { MemberSelect } from "@/components/oa/member-picker";
import { deleteFlow, saveFlow } from "./actions";

type FieldDraft = FormField & { uid: string; optionsText: string; open: boolean };
type StepDraft = ApprovalStep & { uid: string };

export type FlowDesignerProps = {
  flow: {
    id?: string;
    key: string;
    name: string;
    category: string;
    icon: string;
    description: string;
    formSchema: FormField[];
    steps: ApprovalStep[];
    system: boolean;
  };
  instanceCount: number;
  members: MemberOption[];
  roles: { key: string; name: string; count: number }[];
  departments: { id: string; name: string; manager: string | null }[];
};

const APPROVER_TYPES: { value: ApprovalStep["approverType"]; label: string }[] = [
  { value: "manager", label: "申请人直属主管" },
  { value: "user", label: "指定成员" },
  { value: "role", label: "指定角色" },
  { value: "deptManager", label: "指定部门负责人" },
];

let seq = 0;
const uid = () => `u${Date.now().toString(36)}${(seq++).toString(36)}`;

function move<T>(list: T[], i: number, d: -1 | 1) {
  const j = i + d;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

function SectionTitle({ title, description, right }: { title: string; description?: string; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div>
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] text-ink-2">{description}</p>}
      </div>
      {right}
    </div>
  );
}

export function FlowDesigner({ flow, instanceCount, members, roles, departments }: FlowDesignerProps) {
  const router = useRouter();
  const { run, pending } = useAction();
  const isNew = !flow.id;
  const locked = flow.system;

  const [basic, setBasic] = useState({
    key: flow.key,
    name: flow.name,
    category: flow.category,
    icon: flow.icon,
    description: flow.description,
  });
  const [fields, setFields] = useState<FieldDraft[]>(() =>
    flow.formSchema.map((f) => ({ ...f, uid: uid(), optionsText: (f.options ?? []).join("\n"), open: false })),
  );
  const [steps, setSteps] = useState<StepDraft[]>(() => flow.steps.map((s) => ({ ...s, uid: uid() })));
  const [preview, setPreview] = useState<FormValues>({});

  const previewFields = useMemo<FormField[]>(
    () =>
      fields.map((f) => ({
        ...f,
        options: f.optionsText
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
      })),
    [fields],
  );

  const updateField = (id: string, patch: Partial<FieldDraft>) => setFields((list) => list.map((f) => (f.uid === id ? { ...f, ...patch } : f)));
  const updateStep = (id: string, patch: Partial<StepDraft>) => setSteps((list) => list.map((s) => (s.uid === id ? { ...s, ...patch } : s)));

  const addField = (type: FormField["type"]) => {
    const used = new Set(fields.map((f) => f.name));
    let n = fields.length + 1;
    while (used.has(`field${n}`)) n++;
    setFields((list) => [
      ...list,
      {
        uid: uid(),
        name: `field${n}`,
        label: FIELD_TYPE_LABELS[type],
        type,
        required: false,
        optionsText: type === "select" ? "选项一\n选项二" : "",
        open: true,
      },
    ]);
  };

  const addStep = (at: number) =>
    setSteps((list) => {
      const next = [...list];
      next.splice(at, 0, { uid: uid(), name: "审批", approverType: "manager" });
      return next;
    });

  const save = () => {
    run(
      () =>
        saveFlow({
          id: flow.id,
          ...basic,
          formSchema: previewFields.map((f) => ({
            name: f.name,
            label: f.label,
            type: f.type,
            required: !!f.required,
            options: f.type === "select" ? f.options : undefined,
            placeholder: f.placeholder || undefined,
          })),
          steps: steps.map((s) => ({
            name: s.name,
            approverType: s.approverType,
            approverId: s.approverType === "user" ? s.approverId : undefined,
            roleKey: s.approverType === "role" ? s.roleKey : undefined,
            departmentId: s.approverType === "deptManager" ? s.departmentId : undefined,
          })),
        }),
      {
        success: isNew ? "流程已创建" : "流程已保存",
        onSuccess: () => router.push("/oa/flows"),
        refresh: false,
      },
    );
  };

  return (
    <div className="space-y-10">
      <section>
        <SectionTitle title="基本信息" description={locked ? "业务单据专用流程由系统维护，只能调整审批节点" : undefined} />
        <Card className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-[72px_1fr_1fr]">
          <Field label="图标" required>
            <Input
              value={basic.icon}
              disabled={locked}
              maxLength={16}
              onChange={(e) => setBasic({ ...basic, icon: e.target.value })}
              className="h-10 text-center text-xl"
            />
          </Field>
          <Field label="流程名称" required className="sm:col-span-2">
            <Input value={basic.name} disabled={locked} maxLength={30} onChange={(e) => setBasic({ ...basic, name: e.target.value })} className="h-10" />
          </Field>
          <Field label="分类" required className="sm:col-start-2">
            <Input
              list="flow-categories"
              value={basic.category}
              disabled={locked}
              maxLength={20}
              onChange={(e) => setBasic({ ...basic, category: e.target.value })}
              className="h-10"
            />
            <datalist id="flow-categories">
              {FLOW_CATEGORIES.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <Field
            label="流程标识（key）"
            required
            hint={isNew ? "小写字母开头，用于程序识别，创建后不可修改" : "创建后不可修改"}
          >
            <Input
              value={basic.key}
              disabled={!isNew}
              maxLength={40}
              onChange={(e) => setBasic({ ...basic, key: e.target.value.toLowerCase() })}
              className="font-mono"
              placeholder="例如 overtime"
            />
          </Field>
          <Field label="描述" className="sm:col-span-2 sm:col-start-2">
            <Textarea
              rows={2}
              value={basic.description}
              disabled={locked}
              maxLength={200}
              onChange={(e) => setBasic({ ...basic, description: e.target.value })}
              placeholder="在发起审批页展示，帮助同事选择正确的流程"
            />
          </Field>
        </Card>
      </section>

      <section>
        <SectionTitle
          title="表单设计"
          description={locked ? "业务单据流程的表单数据来自关联单据，不可编辑" : "添加申请人需要填写的字段，右侧实时预览"}
        />
        {!locked && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
            <div className="space-y-2">
              {fields.length === 0 && (
                <div className="rounded-lg border border-dashed border-line-strong py-8 text-center text-[13px] text-ink-3">
                  还没有字段，从下方选择字段类型添加
                </div>
              )}
              {fields.map((f, i) => (
                <div key={f.uid} className="rounded-lg border border-line bg-white">
                  <div className="flex items-center gap-2 px-2 py-1.5">
                    <IconButton aria-label={f.open ? "收起" : "展开"} onClick={() => updateField(f.uid, { open: !f.open })}>
                      {f.open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                    </IconButton>
                    <Input
                      value={f.label}
                      maxLength={30}
                      onChange={(e) => updateField(f.uid, { label: e.target.value })}
                      className="h-7 flex-1 border-transparent px-1.5 font-medium hover:border-line-strong"
                      placeholder="字段名称"
                    />
                    <Select
                      value={f.type}
                      onChange={(e) => {
                        const type = e.target.value as FormField["type"];
                        updateField(f.uid, { type, optionsText: type === "select" && !f.optionsText ? "选项一\n选项二" : f.optionsText });
                      }}
                      className="h-7 w-28 text-[13px]"
                    >
                      {Object.entries(FIELD_TYPE_LABELS).map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </Select>
                    <Checkbox
                      label="必填"
                      checked={!!f.required}
                      onChange={(e) => updateField(f.uid, { required: e.target.checked })}
                      className="text-[13px]"
                    />
                    <div className="flex items-center">
                      <IconButton aria-label="上移" disabled={i === 0} onClick={() => setFields((l) => move(l, i, -1))}>
                        <ArrowUp className="size-3.5" />
                      </IconButton>
                      <IconButton aria-label="下移" disabled={i === fields.length - 1} onClick={() => setFields((l) => move(l, i, 1))}>
                        <ArrowDown className="size-3.5" />
                      </IconButton>
                      <IconButton aria-label="删除字段" onClick={() => setFields((l) => l.filter((x) => x.uid !== f.uid))} className="hover:text-danger">
                        <Trash2 className="size-3.5" />
                      </IconButton>
                    </div>
                  </div>
                  {f.open && (
                    <div className="grid grid-cols-1 gap-3 border-t border-line px-4 py-3 sm:grid-cols-2">
                      {f.type === "select" && (
                        <Field label="选项（每行一个）" required className="sm:col-span-2">
                          <Textarea rows={4} value={f.optionsText} onChange={(e) => updateField(f.uid, { optionsText: e.target.value })} />
                        </Field>
                      )}
                      {f.type !== "select" && f.type !== "user" && f.type !== "date" && (
                        <Field label="占位提示">
                          <Input
                            value={f.placeholder ?? ""}
                            maxLength={60}
                            onChange={(e) => updateField(f.uid, { placeholder: e.target.value })}
                            placeholder={`请输入${f.label}`}
                          />
                        </Field>
                      )}
                      <Field label="字段标识" hint="保存在审批数据中的键名，已有审批数据时请勿修改">
                        <Input
                          value={f.name}
                          maxLength={40}
                          onChange={(e) => updateField(f.uid, { name: e.target.value.replace(/[^A-Za-z0-9_]/g, "") })}
                          className="font-mono text-[13px]"
                        />
                      </Field>
                    </div>
                  )}
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="mr-1 text-xs text-ink-3">添加字段</span>
                {Object.entries(FIELD_TYPE_LABELS).map(([type, label]) => (
                  <Button key={type} size="xs" variant="subtle" onClick={() => addField(type as FormField["type"])}>
                    <Plus className="size-3" />
                    {label}
                  </Button>
                ))}
              </div>
            </div>
            <Card className="h-fit p-4 lg:sticky lg:top-14">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[13px] font-semibold text-ink">表单预览</span>
                <Badge>申请人视角</Badge>
              </div>
              <div className="mb-4">
                <Label required>审批标题</Label>
                <Input disabled value={`申请人的${basic.name || "流程"}`} />
              </div>
              <DynamicFormFields
                fields={previewFields}
                values={preview}
                members={members}
                onChange={(name, v) => setPreview((p) => ({ ...p, [name]: v }))}
                empty={<p className="text-[13px] text-ink-3">暂无字段</p>}
              />
            </Card>
          </div>
        )}
      </section>

      <section>
        <SectionTitle title="审批节点" description="按顺序流转；同一节点有多名审批人时为或签，任一人处理即可" />
        <div className="max-w-2xl">
          <div className="flex items-center gap-2.5 rounded-lg border border-line bg-sidebar px-3 py-2 text-sm">
            <span className="flex size-6 items-center justify-center rounded-full bg-[#448361] text-white">
              <Send className="size-3" />
            </span>
            <span className="font-medium text-ink">发起人</span>
            <span className="text-[13px] text-ink-3">所有成员可发起</span>
          </div>
          {steps.map((s, i) => (
            <div key={s.uid}>
              <Connector onAdd={() => addStep(i)} />
              <div className="rounded-lg border border-line bg-white p-3 shadow-card">
                <div className="flex items-center gap-2">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-medium text-white">{i + 1}</span>
                  <Input
                    value={s.name}
                    maxLength={30}
                    onChange={(e) => updateStep(s.uid, { name: e.target.value })}
                    className="h-7 flex-1 border-transparent px-1.5 font-medium hover:border-line-strong"
                    placeholder="节点名称"
                  />
                  <IconButton aria-label="上移" disabled={i === 0} onClick={() => setSteps((l) => move(l, i, -1))}>
                    <ArrowUp className="size-3.5" />
                  </IconButton>
                  <IconButton aria-label="下移" disabled={i === steps.length - 1} onClick={() => setSteps((l) => move(l, i, 1))}>
                    <ArrowDown className="size-3.5" />
                  </IconButton>
                  <IconButton
                    aria-label="删除节点"
                    disabled={steps.length <= 1}
                    onClick={() => setSteps((l) => l.filter((x) => x.uid !== s.uid))}
                    className="hover:text-danger"
                  >
                    <Trash2 className="size-3.5" />
                  </IconButton>
                </div>
                <div className="mt-2 grid grid-cols-1 gap-2 pl-8 sm:grid-cols-2">
                  <Select
                    value={s.approverType}
                    onChange={(e) => updateStep(s.uid, { approverType: e.target.value as ApprovalStep["approverType"] })}
                    aria-label="审批人类型"
                  >
                    {APPROVER_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </Select>
                  {s.approverType === "user" && (
                    <MemberSelect members={members} value={s.approverId} onChange={(id) => updateStep(s.uid, { approverId: id ?? undefined })} />
                  )}
                  {s.approverType === "role" && (
                    <Select value={s.roleKey ?? ""} onChange={(e) => updateStep(s.uid, { roleKey: e.target.value || undefined })} aria-label="审批角色">
                      <option value="">选择角色</option>
                      {roles.map((r) => (
                        <option key={r.key} value={r.key}>
                          {r.name}（{r.count} 人）
                        </option>
                      ))}
                    </Select>
                  )}
                  {s.approverType === "deptManager" && (
                    <Select
                      value={s.departmentId ?? ""}
                      onChange={(e) => updateStep(s.uid, { departmentId: e.target.value || undefined })}
                      aria-label="部门"
                    >
                      <option value="">选择部门</option>
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                          {d.manager ? `（${d.manager}）` : "（未设负责人）"}
                        </option>
                      ))}
                    </Select>
                  )}
                  {s.approverType === "manager" && (
                    <p className="self-center text-xs text-ink-3">申请人所在部门的负责人；申请人本身是负责人时由上级部门负责人审批</p>
                  )}
                </div>
              </div>
            </div>
          ))}
          <Connector onAdd={() => addStep(steps.length)} />
          <div className="flex items-center gap-2.5 rounded-lg border border-line bg-sidebar px-3 py-2 text-sm">
            <span className="flex size-6 items-center justify-center rounded-full bg-hover text-ink-3">
              <Flag className="size-3" />
            </span>
            <span className="font-medium text-ink-2">结束</span>
            <span className="text-[13px] text-ink-3">通知申请人审批结果</span>
          </div>
        </div>
      </section>

      <div className="sticky bottom-0 z-10 -mx-2 flex items-center gap-2 border-t border-line bg-white/95 px-2 py-3 backdrop-blur">
        <Button variant="primary" size="md" loading={pending} onClick={save}>
          {isNew ? "创建流程" : "保存修改"}
        </Button>
        <LinkButton href="/oa/flows" variant="ghost" size="md">
          取消
        </LinkButton>
        {!isNew && !flow.system && (
          <div className="ml-auto">
            <ConfirmButton
              danger
              title="删除流程"
              description={
                instanceCount > 0 ? `该流程已有 ${instanceCount} 条审批记录，无法删除，建议停用。` : "删除后不可恢复，确定删除该流程吗？"
              }
              confirmText="删除"
              disabled={instanceCount > 0}
              onConfirm={() =>
                run(() => deleteFlow(flow.id!), { success: "流程已删除", refresh: false, onSuccess: () => router.push("/oa/flows") })
              }
            >
              <Trash2 className="size-3.5" />
              删除流程
            </ConfirmButton>
          </div>
        )}
      </div>
    </div>
  );
}

function Connector({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="relative h-10">
      <span className="absolute inset-y-0 left-[24px] w-px bg-line-strong" />
      <button
        type="button"
        onClick={onAdd}
        aria-label="在此添加审批节点"
        title="添加审批节点"
        className="absolute left-[14px] top-1/2 z-10 flex size-5 -translate-y-1/2 items-center justify-center rounded-full border border-line-strong bg-white text-ink-3 transition-colors hover:border-accent hover:text-accent"
      >
        <Plus className="size-3" />
      </button>
    </div>
  );
}
