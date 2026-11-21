import { requireUser } from "@/lib/auth/dal";
import { Page, PageHeader } from "@/components/ui/page";

export default async function HomePage() {
  const user = await requireUser();
  return (
    <Page>
      <PageHeader icon="👋" title={`你好，${user.name}`} description="欢迎回到协作空间" />
    </Page>
  );
}
