import "dotenv/config";
import { db } from "@/lib/db";
import { seedBase } from "./base";
import { seedDocs } from "./modules/docs";
import { seedOa } from "./modules/oa";
import { seedCrm } from "./modules/crm";
import { seedPms } from "./modules/pms";
import { seedErp } from "./modules/erp";
import { seedWmsTms } from "./modules/wms-tms";

async function main() {
  const existing = await db.user.count();
  if (existing > 0) {
    console.log("数据库已有数据，跳过种子。如需重置请运行 pnpm db:reset");
    return;
  }
  await db.$queryRawUnsafe("PRAGMA journal_mode = WAL;");
  console.log("→ 基础数据");
  const ctx = await seedBase();
  console.log("→ 文档");
  await seedDocs(ctx);
  console.log("→ OA");
  await seedOa(ctx);
  console.log("→ CRM");
  await seedCrm(ctx);
  console.log("→ PMS");
  await seedPms(ctx);
  console.log("→ ERP / 财务");
  await seedErp(ctx);
  console.log("→ WMS / TMS");
  await seedWmsTms(ctx);
  console.log("✓ 种子数据完成");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
