import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { groupByPinyin, pinyinInitial } from "@/lib/pinyin";
import { contactsDeptScope } from "@/lib/contacts";

describe("pinyinInitial（通讯录拼音首字母）", () => {
  const cases: Record<string, string> = {
    A: "安艾敖阿啊",
    B: "白包鲍毕巴八",
    C: "陈程蔡曹崔常",
    D: "邓丁杜戴董大",
    F: "冯范方傅付",
    G: "郭高顾龚甘",
    H: "黄胡何韩郝哈",
    J: "金江蒋姜贾",
    K: "孔康柯卡",
    L: "李刘林梁罗吕陆",
    M: "马毛孟莫妈",
    N: "倪聂牛宁那拿",
    O: "欧区",
    P: "潘彭裴庞朴",
    Q: "钱秦邱齐仇",
    R: "任阮饶荣冉",
    S: "孙宋苏沈石单",
    T: "唐田陶谭他",
    W: "王吴魏汪武",
    X: "徐许谢萧熊解",
    Y: "杨叶于余袁丫",
    Z: "张赵周朱郑曾查翟",
  };
  for (const [letter, chars] of Object.entries(cases)) {
    it(`${letter}：${chars}`, () => {
      for (const ch of chars) assert.equal(pinyinInitial(`${ch}某`), letter, ch);
    });
  }

  it("英文名按首字母（含全角），数字 / 符号 / 表情 / 其他文字归入 #", () => {
    assert.equal(pinyinInitial("alice"), "A");
    assert.equal(pinyinInitial("Bob"), "B");
    assert.equal(pinyinInitial("ｚｏｅ"), "Z");
    for (const s of ["123", "１号", "_x", "😀笑", "Ωmega", "", "   "]) assert.equal(pinyinInitial(s), "#", JSON.stringify(s));
    assert.equal(pinyinInitial("  王芳"), "W");
  });
});

describe("groupByPinyin", () => {
  it("按 A–Z 分组、组内按拼音排序，# 组在最后", () => {
    const groups = groupByPinyin(["王芳", "张伟", "李娜", "123", "陈静", "刘洋", "吴婷", "Alice", "周敏"], (x) => x);
    assert.deepEqual(
      groups.map((g) => g.letter),
      ["A", "C", "L", "W", "Z", "#"],
    );
    assert.deepEqual(groups.find((g) => g.letter === "L")!.items, ["李娜", "刘洋"]);
    assert.deepEqual(groups.find((g) => g.letter === "W")!.items, ["王芳", "吴婷"]);
    assert.deepEqual(groups.find((g) => g.letter === "Z")!.items, ["张伟", "周敏"]);
    assert.deepEqual(groups.at(-1)!.items, ["123"]);
  });
});

describe("contactsDeptScope（通讯录部门筛选）", () => {
  const depts = [
    { id: "ceo", parentId: null },
    { id: "sales", parentId: "ceo" },
    { id: "rd", parentId: "ceo" },
    { id: "fe", parentId: "rd" },
  ];

  it("只列直属成员：上级部门不把所有下级部门的人都算进来", () => {
    const s = contactsDeptScope(depts, "ceo")!;
    assert.deepEqual(s.memberDeptIds, ["ceo"]);
    assert.deepEqual(
      s.children.map((d) => d.id),
      ["sales", "rd"],
    );
  });

  it("叶子部门没有下级", () => {
    assert.deepEqual(contactsDeptScope(depts, "fe"), { memberDeptIds: ["fe"], children: [] });
  });

  it("未知部门 / 未选部门 → 不筛选", () => {
    assert.equal(contactsDeptScope(depts, "nope"), null);
    assert.equal(contactsDeptScope(depts, ""), null);
  });
});
