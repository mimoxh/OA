"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { FormField } from "@/lib/services/approval";
import { validateFormData, type FormValues } from "@/lib/oa/form";
import type { MemberOption } from "@/lib/oa/types";
import { Button, LinkButton } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useAction } from "@/components/ui/use-action";
import { DynamicFormFields } from "@/components/oa/dynamic-form";
import { submitApproval } from "../actions";

export function NewApprovalForm({
  flowKey,
  fields,
  members,
  defaultTitle,
  initialValues,
}: {
  flowKey: string;
  fields: FormField[];
  members: MemberOption[];
  defaultTitle: string;
  initialValues: FormValues;
}) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [title, setTitle] = useState(defaultTitle);
  const [values, setValues] = useState<FormValues>(initialValues);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = () => {
    const { errors: errs } = validateFormData(fields, values);
    if (!title.trim()) errs.__title = "请填写审批标题";
    setErrors(errs);
    const first = Object.values(errs)[0];
    if (first) {
      toast.error(first);
      return;
    }
    run(() => submitApproval({ flowKey, title: title.trim(), formData: values }), {
      success: "审批已提交",
      refresh: false,
      onSuccess: (d) => router.push(`/oa/approvals/${d.id}`),
    });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-5"
    >
      <div>
        <Label required>审批标题</Label>
        <Input value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} className={errors.__title ? "border-danger" : undefined} />
        {errors.__title && <p className="mt-1 text-xs text-danger">{errors.__title}</p>}
      </div>
      <div className="border-t border-line pt-5">
        <DynamicFormFields
          fields={fields}
          values={values}
          errors={errors}
          members={members}
          onChange={(name, v) => {
            setValues((prev) => ({ ...prev, [name]: v }));
            if (errors[name])
              setErrors((prev) => {
                const next = { ...prev };
                delete next[name];
                return next;
              });
          }}
        />
      </div>
      <div className="flex items-center gap-2 border-t border-line pt-4">
        <Button type="submit" variant="primary" size="md" loading={pending}>
          提交审批
        </Button>
        <LinkButton href="/oa/approvals/new" variant="ghost" size="md">
          取消
        </LinkButton>
      </div>
    </form>
  );
}
