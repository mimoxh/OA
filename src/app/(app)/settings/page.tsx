import { redirect } from "next/navigation";
import { can, requireUser } from "@/lib/auth/dal";

export default async function SettingsIndex() {
  const user = await requireUser();
  redirect(can(user, "admin") ? "/settings/members" : "/settings/profile");
}
