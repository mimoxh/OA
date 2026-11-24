/**
 * 把 Next standalone 里 pnpm 结构的 node_modules（依赖是指向 .pnpm/<id>/node_modules/* 的目录联接，
 * Windows 上联接保存的是绝对路径，产物无法挪动）展开为 npm 式的扁平目录：
 * 每个包名在顶层只放一个版本，版本冲突的依赖嵌套到使用方自己的 node_modules 下。
 */
import fs from "node:fs";
import path from "node:path";

/** 列出 node_modules 目录中的包（含 @scope/name），跳过 .pnpm / .bin 等隐藏目录 */
function listPackages(nm) {
  const out = [];
  if (!fs.existsSync(nm)) return out;
  for (const e of fs.readdirSync(nm, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const p = path.join(nm, e.name);
    if (e.name.startsWith("@")) {
      for (const s of fs.readdirSync(p)) out.push([`${e.name}/${s}`, path.join(p, s)]);
    } else {
      out.push([e.name, p]);
    }
  }
  return out;
}

function packageName(realDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(realDir, "package.json"), "utf8")).name;
  } catch {
    return null;
  }
}

/** pnpm 中包的依赖就是同一个 .pnpm/<id>/node_modules 下的其它条目 */
function depsOf(realDir, name) {
  const nm = name.includes("/") ? path.dirname(path.dirname(realDir)) : path.dirname(realDir);
  if (path.basename(nm) !== "node_modules") return [];
  const deps = [];
  for (const [n, p] of listPackages(nm)) {
    if (n === name) continue;
    try {
      deps.push([n, fs.realpathSync(p)]);
    } catch {}
  }
  return deps;
}

/**
 * @param {{ root: string, roots: { nmDir: string, folder: string, link: string }[] }} opts
 *   root: 输出根目录；roots: 需要放置的入口包（目标 node_modules、目录名、standalone 中的原路径）
 */
export function flattenPnpm({ root, roots }) {
  const placed = new Map(); // node_modules 目录 → (目录名 → 真实路径)
  const queue = [];

  const place = (nmDir, folder, realDir, name) => {
    if (!placed.has(nmDir)) placed.set(nmDir, new Map());
    placed.get(nmDir).set(folder, realDir);
    const dest = path.join(nmDir, folder);
    fs.cpSync(realDir, dest, {
      recursive: true,
      dereference: true,
      filter: (src) => src === realDir || !src.startsWith(path.join(realDir, "node_modules")),
    });
    queue.push({ location: dest, realDir, name });
  };

  // 按 Node 的解析规则：从包所在目录逐级向上查找 <dir>/node_modules/<name>
  const resolveFrom = (location, name) => {
    let dir = location;
    for (;;) {
      if (path.basename(dir) !== "node_modules") {
        const hit = placed.get(path.join(dir, "node_modules"))?.get(name);
        if (hit) return hit;
      }
      const parent = path.dirname(dir);
      if (parent === dir || !parent.startsWith(root)) return null;
      dir = parent;
    }
  };

  const top = path.join(root, "node_modules");
  const entries = roots.map((r) => ({ ...r, realDir: fs.realpathSync(r.link) }));
  for (const e of entries) place(e.nmDir, e.folder, e.realDir, packageName(e.realDir) ?? e.folder);

  // 先把所有传递依赖按首次出现的版本提升到顶层
  const seen = new Set(entries.map((e) => e.realDir));
  const walk = [...entries.map((e) => [e.realDir, packageName(e.realDir) ?? e.folder])];
  while (walk.length) {
    const [realDir, name] = walk.shift();
    for (const [dep, depReal] of depsOf(realDir, name)) {
      if (seen.has(depReal)) continue;
      seen.add(depReal);
      if (!placed.get(top)?.has(dep)) place(top, dep, depReal, dep);
      walk.push([depReal, dep]);
    }
  }

  // 再逐个检查依赖能否解析到正确版本，不能的嵌套到使用方的 node_modules
  const checked = new Set();
  for (let i = 0; i < queue.length; i++) {
    const { location, realDir, name } = queue[i];
    for (const [dep, depReal] of depsOf(realDir, name)) {
      if (resolveFrom(location, dep) === depReal) continue;
      const key = `${location}|${dep}`;
      if (checked.has(key)) continue;
      checked.add(key);
      place(path.join(location, "node_modules"), dep, depReal, dep);
    }
    if (queue.length > 5000) throw new Error("依赖展开异常：嵌套层级过多");
  }
  return queue.length;
}
