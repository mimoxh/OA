import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/dal";
import { Page, PageHeader, TopBar } from "@/components/ui/page";
import { VoucherForm } from "@/components/finance/voucher-form";

export default async function NewVoucherPage() {
  await requirePermission("finance:edit");
  const accounts = await db.account.findMany({ orderBy: { code: "asc" }, select: { code: true, name: true, type: true } });
  return (
    <>
      <TopBar crumbs={[{ label: "财务", href: "/finance" }, { label: "记账凭证", href: "/finance/vouchers" }, { label: "手工凭证" }]} />
      <Page>
        <PageHeader icon="✍️" title="新建手工凭证" description="用于费用、调整等无业务单据的记账，借贷必须平衡才能保存" />
        <VoucherForm accounts={accounts} />
      </Page>
    </>
  );
}
