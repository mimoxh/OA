import "./setup-db";
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { db } from "@/lib/db";
import { createProjectSpace, ProjectSpaceExistsError, upgradeProject } from "@/lib/pms/space";
import { DEFAULT_TASK_TYPES } from "@/lib/pms/utils";

let owner: { id: string };
let member: { id: string };
let publicSpace: { id: string };
let seq = 0;

async function makeProject(extra: { documentId?: string | null; taskTypesReady?: boolean } = {}) {
  const n = ++seq;
  const p = await db.project.create({
    data: {
      code: `PRJ-${n}`,
      name: `项目 ${n}`,
      ownerId: owner.id,
      documentId: extra.documentId ?? null,
      taskTypesReady: extra.taskTypesReady ?? false,
      members: { create: [{ userId: owner.id, role: "owner" }, { userId: member.id, role: "member" }] },
    },
  });
  return p;
}

async function makeDoc(title: string, parentId: string | null = null) {
  return db.document.create({ data: { spaceId: publicSpace.id, title, parentId, createdById: owner.id, updatedById: owner.id } });
}

const reload = (id: string) => db.project.findUniqueOrThrow({ where: { id } });

before(async () => {
  const role = await db.role.create({ data: { key: "member", name: "成员", permissions: "[]" } });
  owner = await db.user.create({ data: { email: "owner@test.local", name: "Owner", passwordHash: "x", roleId: role.id } });
  member = await db.user.create({ data: { email: "member@test.local", name: "Member", passwordHash: "x", roleId: role.id } });
  publicSpace = await db.space.create({ data: { name: "公共空间", visibility: "PUBLIC", createdById: owner.id } });
});

describe("upgradeProject", () => {
  it("把旧版项目文档（含子页面与附件）迁入新建的私有项目空间，并补建默认任务类型", async () => {
    const doc = await makeDoc("旧项目文档");
    const child = await makeDoc("子页面", doc.id);
    await db.documentAttachment.create({
      data: { id: `att-${seq}`, spaceId: publicSpace.id, documentId: child.id, fileName: "a.png", mediaType: "image/png", size: 1, sha256: "x", createdById: owner.id },
    });
    const p = await makeProject({ documentId: doc.id });

    await upgradeProject(p);

    const after = await reload(p.id);
    assert.ok(after.spaceId);
    assert.equal(after.documentId, null);
    assert.equal(after.taskTypesReady, true);
    const space = await db.space.findUniqueOrThrow({ where: { id: after.spaceId }, include: { members: true } });
    assert.equal(space.visibility, "PRIVATE");
    assert.deepEqual(
      space.members.map((m) => [m.userId, m.role]).sort(),
      [[owner.id, "owner"], [member.id, "editor"]].sort(),
    );
    const docs = await db.document.findMany({ where: { id: { in: [doc.id, child.id] } } });
    assert.ok(docs.every((d) => d.spaceId === after.spaceId));
    assert.equal(docs.find((d) => d.id === doc.id)?.parentId, null);
    assert.equal(docs.find((d) => d.id === child.id)?.parentId, doc.id);
    const att = await db.documentAttachment.findFirstOrThrow({ where: { documentId: child.id } });
    assert.equal(att.spaceId, after.spaceId);
    // 迁移旧文档时不额外新建「项目概述」
    assert.equal(await db.document.count({ where: { spaceId: after.spaceId } }), 2);
    const types = await db.taskType.findMany({ where: { projectId: p.id }, orderBy: { sortOrder: "asc" } });
    assert.deepEqual(types.map((t) => t.name), DEFAULT_TASK_TYPES.map((t) => t.name));
  });

  it("重复调用是幂等的", async () => {
    const doc = await makeDoc("旧文档-幂等");
    const p = await makeProject({ documentId: doc.id });
    await upgradeProject(p);
    const first = await reload(p.id);
    // 用升级前的旧快照再调用一次（模拟同一请求里拿到的过期数据）
    await upgradeProject(p);
    const second = await reload(p.id);
    assert.equal(second.spaceId, first.spaceId);
    assert.equal(await db.space.count({ where: { name: p.name } }), 1);
    assert.equal(await db.taskType.count({ where: { projectId: p.id } }), DEFAULT_TASK_TYPES.length);
  });

  it("并发打开同一个项目只会创建一个空间和一套任务类型", async () => {
    const doc = await makeDoc("旧文档-并发");
    const p = await makeProject({ documentId: doc.id });
    await Promise.all(Array.from({ length: 6 }, () => upgradeProject(p)));
    const after = await reload(p.id);
    assert.ok(after.spaceId);
    assert.equal(await db.space.count({ where: { name: p.name } }), 1);
    assert.equal(await db.taskType.count({ where: { projectId: p.id } }), DEFAULT_TASK_TYPES.length);
  });

  it("旧文档已不存在时只清除失效关联，不创建空的文档空间", async () => {
    const p = await makeProject({ documentId: "missing-doc-id" });
    await upgradeProject(p);
    const after = await reload(p.id);
    assert.equal(after.documentId, null);
    assert.equal(after.spaceId, null);
    assert.equal(await db.space.count({ where: { name: p.name } }), 0);
  });

  it("已有同名任务类型时补建不会失败，也不会产生重复", async () => {
    const p = await makeProject({ taskTypesReady: false });
    await db.taskType.create({ data: { projectId: p.id, name: DEFAULT_TASK_TYPES[0].name, color: "gray" } });
    await upgradeProject(p);
    const names = (await db.taskType.findMany({ where: { projectId: p.id } })).map((t) => t.name).sort();
    assert.deepEqual(names, DEFAULT_TASK_TYPES.map((t) => t.name).sort());
    assert.equal((await reload(p.id)).taskTypesReady, true);
  });
});

describe("createProjectSpace", () => {
  it("项目已有空间时抛出 ProjectSpaceExistsError 并回滚，不留下孤立空间", async () => {
    const p = await makeProject({ taskTypesReady: true });
    await db.$transaction((tx) => createProjectSpace(tx, p, { actorId: owner.id, createOverview: true }));
    const before = await db.space.count();
    await assert.rejects(
      db.$transaction((tx) => createProjectSpace(tx, p, { actorId: owner.id, createOverview: true })),
      ProjectSpaceExistsError,
    );
    assert.equal(await db.space.count(), before);
  });
});
