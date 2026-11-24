"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { runAction } from "@/lib/action";
import { audit } from "@/lib/services/notify";
import { ALL_PERMISSIONS, MODULES, parsePermissions, type ModuleKey } from "@/lib/permissions";
import { appDependents, appName, missingRequirements } from "@/lib/apps";
import { getDisabledApps } from "@/lib/apps-store";
import { parseInput } from "@/lib/oa/validate";
import { createPersonalSpace } from "@/lib/docs/personal";

const id = z.string().min(1);
const optionalText = (max: number, label: string) => z.string().trim().max(max, `${label}不能超过 ${max} 字`).optional();
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "颜色格式不正确");
const email = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "邮箱格式不正确");
const password = z.string().min(6, "密码至少 6 位").max(64, "密码不能超过 64 位");

const BOT_MANAGED = "机器人账号请在「设置 · Webhook 机器人」中管理";

async function assertNotBot(userId: string) {
  const u = await db.user.findUnique({ where: { id: userId }, select: { isBot: true } });
  if (u?.isBot) throw new Error(BOT_MANAGED);
}

function revalidateOrg() {
  revalidatePath("/settings", "layout");
}

// ───────────── 成员 ─────────────

const memberSchema = z.object({
  name: z.string().trim().min(1, "请填写姓名").max(30, "姓名不能超过 30 字"),
  email,
  departmentId: z.string().optional(),
  roleId: z.string().min(1, "请选择角色"),
  title: optionalText(30, "职位"),
  phone: optionalText(20, "手机"),
  avatarColor: color,
});

async function checkRefs(v: { departmentId?: string; roleId: string }) {
  const role = await db.role.findUnique({ where: { id: v.roleId } });
  if (!role) throw new Error("角色不存在");
  if (v.departmentId && !(await db.department.findUnique({ where: { id: v.departmentId } }))) throw new Error("部门不存在");
  return role;
}

export async function createMember(input: z.input<typeof memberSchema> & { password: string }) {
  return runAction("admin", async (user) => {
    const v = parseInput(memberSchema.extend({ password }), input);
    await checkRefs(v);
    if (await db.user.findUnique({ where: { email: v.email } })) throw new Error("该邮箱已被使用");
    const passwordHash = await bcrypt.hash(v.password, 10);
    const created = await db.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          name: v.name,
          email: v.email,
          passwordHash,
          departmentId: v.departmentId || null,
          roleId: v.roleId,
          title: v.title || null,
          phone: v.phone || null,
          avatarColor: v.avatarColor,
        },
      });
      await createPersonalSpace(tx, u.id);
      return u;
    });
    await audit(db, { entityType: "user", entityId: created.id, action: "create", userId: user.id });
    revalidateOrg();
    return { id: created.id };
  });
}

export async function updateMember(input: z.input<typeof memberSchema> & { id: string }) {
  return runAction("admin", async (user) => {
    const v = parseInput(memberSchema.extend({ id }), input);
    const role = await checkRefs(v);
    const target = await db.user.findUnique({ where: { id: v.id } });
    if (!target) throw new Error("成员不存在");
    if (target.isBot) throw new Error(BOT_MANAGED);
    const dup = await db.user.findUnique({ where: { email: v.email } });
    if (dup && dup.id !== v.id) throw new Error("该邮箱已被使用");
    if (v.id === user.id && !parsePermissions(role.permissions).includes("admin")) {
      throw new Error("不能移除自己的管理员权限");
    }
    await db.user.update({
      where: { id: v.id },
      data: {
        name: v.name,
        email: v.email,
        departmentId: v.departmentId || null,
        roleId: v.roleId,
        title: v.title || null,
        phone: v.phone || null,
        avatarColor: v.avatarColor,
      },
    });
    await audit(db, { entityType: "user", entityId: v.id, action: "update", userId: user.id });
    revalidateOrg();
  });
}

export async function resetMemberPassword(input: { id: string; password: string }) {
  return runAction("admin", async (user) => {
    const v = parseInput(z.object({ id, password }), input);
    await assertNotBot(v.id);
    await db.user.update({ where: { id: v.id }, data: { passwordHash: await bcrypt.hash(v.password, 10) } });
    await audit(db, { entityType: "user", entityId: v.id, action: "reset_password", userId: user.id });
  });
}

export async function setMemberActive(memberId: string, active: boolean) {
  return runAction("admin", async (user) => {
    const uid = parseInput(id, memberId);
    if (uid === user.id && !active) throw new Error("不能停用自己的账号");
    await assertNotBot(uid);
    await db.user.update({ where: { id: uid }, data: { active: !!active } });
    await audit(db, { entityType: "user", entityId: uid, action: active ? "activate" : "deactivate", userId: user.id });
    revalidateOrg();
  });
}

// ───────────── 部门 ─────────────

const deptSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "请填写部门名称").max(30, "部门名称不能超过 30 字"),
  parentId: z.string().optional(),
  managerId: z.string().optional(),
});

export async function saveDepartment(input: z.input<typeof deptSchema>) {
  return runAction("admin", async (user) => {
    const v = parseInput(deptSchema, input);
    const parentId = v.parentId || null;
    const managerId = v.managerId || null;
    if (parentId && !(await db.department.findUnique({ where: { id: parentId } }))) throw new Error("上级部门不存在");
    if (managerId && !(await db.user.findUnique({ where: { id: managerId } }))) throw new Error("负责人不存在");
    if (v.id) {
      if (parentId) {
        const all = await db.department.findMany({ select: { id: true, parentId: true } });
        const parentOf = new Map(all.map((d) => [d.id, d.parentId]));
        let cur: string | null = parentId;
        while (cur) {
          if (cur === v.id) throw new Error("不能把部门移动到它自己或其下级部门下");
          cur = parentOf.get(cur) ?? null;
        }
      }
      await db.department.update({ where: { id: v.id }, data: { name: v.name, parentId, managerId } });
      await audit(db, { entityType: "department", entityId: v.id, action: "update", userId: user.id });
      revalidateOrg();
      return { id: v.id };
    }
    const max = await db.department.aggregate({ where: { parentId }, _max: { sortOrder: true } });
    const d = await db.department.create({ data: { name: v.name, parentId, managerId, sortOrder: (max._max.sortOrder ?? -1) + 1 } });
    await audit(db, { entityType: "department", entityId: d.id, action: "create", userId: user.id });
    revalidateOrg();
    return { id: d.id };
  });
}

export async function setDepartmentManager(deptId: string, managerId: string | null) {
  return runAction("admin", async (user) => {
    const did = parseInput(id, deptId);
    await db.department.update({ where: { id: did }, data: { managerId: managerId || null } });
    await audit(db, { entityType: "department", entityId: did, action: "set_manager", userId: user.id });
    revalidateOrg();
  });
}

export async function deleteDepartment(deptId: string) {
  return runAction("admin", async (user) => {
    const d = await db.department.findUnique({
      where: { id: parseInput(id, deptId) },
      include: { _count: { select: { members: true, children: true } } },
    });
    if (!d) throw new Error("部门不存在");
    if (d._count.children > 0) throw new Error(`「${d.name}」下还有 ${d._count.children} 个子部门，请先删除或移走子部门`);
    if (d._count.members > 0) throw new Error(`「${d.name}」下还有 ${d._count.members} 名成员，请先调整成员部门`);
    await db.department.delete({ where: { id: d.id } });
    await audit(db, { entityType: "department", entityId: d.id, action: "delete", detail: d.name, userId: user.id });
    revalidateOrg();
  });
}

// ───────────── 角色 ─────────────

const roleSchema = z.object({
  name: z.string().trim().min(1, "请填写角色名称").max(30, "角色名称不能超过 30 字"),
  description: optionalText(100, "描述"),
  permissions: z.array(z.string()),
});

function cleanPermissions(list: string[]) {
  const set = new Set(list.filter((p) => (ALL_PERMISSIONS as string[]).includes(p)));
  if (set.has("admin")) return ["admin"];
  return ALL_PERMISSIONS.filter((p) => set.has(p));
}

export async function createRole(input: z.input<typeof roleSchema> & { key: string }) {
  return runAction("admin", async (user) => {
    const v = parseInput(
      roleSchema.extend({
        key: z
          .string()
          .trim()
          .regex(/^[a-z][a-z0-9_]{1,29}$/, "角色标识需以小写字母开头，只能包含小写字母、数字和下划线"),
      }),
      input,
    );
    if (await db.role.findUnique({ where: { key: v.key } })) throw new Error(`角色标识「${v.key}」已被使用`);
    const r = await db.role.create({
      data: { key: v.key, name: v.name, description: v.description || null, permissions: JSON.stringify(cleanPermissions(v.permissions)) },
    });
    await audit(db, { entityType: "role", entityId: r.id, action: "create", userId: user.id });
    revalidateOrg();
    return { id: r.id };
  });
}

export async function updateRole(input: z.input<typeof roleSchema> & { id: string }) {
  return runAction("admin", async (user) => {
    const v = parseInput(roleSchema.extend({ id }), input);
    const role = await db.role.findUnique({ where: { id: v.id } });
    if (!role) throw new Error("角色不存在");
    let perms = cleanPermissions(v.permissions);
    if (role.key === "admin") perms = ["admin"];
    if (role.id === (await db.user.findUnique({ where: { id: user.id } }))?.roleId && !perms.includes("admin")) {
      throw new Error("不能移除自己所在角色的管理员权限");
    }
    await db.role.update({
      where: { id: role.id },
      data: { name: v.name, description: v.description || null, permissions: JSON.stringify(perms) },
    });
    await audit(db, { entityType: "role", entityId: role.id, action: "update", detail: perms.join(","), userId: user.id });
    revalidatePath("/", "layout");
  });
}

export async function deleteRole(roleId: string) {
  return runAction("admin", async (user) => {
    const role = await db.role.findUnique({ where: { id: parseInput(id, roleId) }, include: { _count: { select: { users: true } } } });
    if (!role) throw new Error("角色不存在");
    if (role.system) throw new Error("系统内置角色不能删除");
    if (role._count.users > 0) throw new Error(`该角色下还有 ${role._count.users} 名成员，请先调整成员角色`);
    await db.role.delete({ where: { id: role.id } });
    await audit(db, { entityType: "role", entityId: role.id, action: "delete", detail: role.name, userId: user.id });
    revalidateOrg();
  });
}

// ───────────── 个人资料 ─────────────

const profileSchema = z.object({
  name: z.string().trim().min(1, "请填写姓名").max(30, "姓名不能超过 30 字"),
  title: optionalText(30, "职位"),
  phone: optionalText(20, "手机"),
  avatarColor: color,
});

export async function updateProfile(input: z.input<typeof profileSchema>) {
  return runAction(null, async (user) => {
    const v = parseInput(profileSchema, input);
    await db.user.update({
      where: { id: user.id },
      data: { name: v.name, title: v.title || null, phone: v.phone || null, avatarColor: v.avatarColor },
    });
    revalidatePath("/", "layout");
  });
}

export async function changePassword(input: { oldPassword: string; newPassword: string }) {
  return runAction(null, async (user) => {
    const v = parseInput(z.object({ oldPassword: z.string().min(1, "请输入当前密码"), newPassword: password }), input);
    const u = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!(await bcrypt.compare(v.oldPassword, u.passwordHash))) throw new Error("当前密码不正确");
    if (v.oldPassword === v.newPassword) throw new Error("新密码不能与当前密码相同");
    await db.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(v.newPassword, 10) } });
    await audit(db, { entityType: "user", entityId: user.id, action: "change_password", userId: user.id });
  });
}

// ───────────── 应用开关 ─────────────

const appKeySchema = z.custom<ModuleKey>((v) => typeof v === "string" && MODULES.some((m) => m.key === v), "应用不存在");

export async function setAppEnabled(key: string, enabled: boolean) {
  return runAction("admin", async (user) => {
    const k = parseInput(appKeySchema, key);
    const name = appName(k);
    await db.$transaction(async (tx) => {
      const disabled = await getDisabledApps(tx);
      const enabledSet = new Set(MODULES.map((m) => m.key).filter((x) => !disabled.has(x)));
      if (!enabled) {
        const deps = appDependents(k, enabledSet);
        if (deps.length) {
          throw new Error(`无法停用「${name}」：${deps.map((d) => `「${appName(d)}」`).join("、")}依赖它，请先停用这些应用`);
        }
      } else {
        const missing = missingRequirements(k, enabledSet);
        if (missing.length) {
          throw new Error(`无法启用「${name}」：它依赖${missing.map((d) => `「${appName(d)}」`).join("、")}，请先启用这些应用`);
        }
      }
      await tx.appSetting.upsert({
        where: { key: k },
        create: { key: k, enabled, updatedById: user.id },
        update: { enabled, updatedById: user.id },
      });
      await audit(tx, { entityType: "app", entityId: k, action: enabled ? "enable" : "disable", userId: user.id });
    });
    revalidatePath("/", "layout");
  });
}
