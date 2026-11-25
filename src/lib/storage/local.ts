import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StorageDriver, StorageObject } from "./types";

/** 本地文件系统存储驱动：默认写入 ./data/uploads，适合单机开发与测试 */
export class LocalStorageDriver implements StorageDriver {
  readonly kind = "local" as const;
  private readonly baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = path.resolve(baseDir);
  }

  private resolveSafe(key: string): string {
    const clean = key.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!clean || clean.includes("..") || path.isAbsolute(clean)) {
      throw new Error("非法的存储路径");
    }
    const target = path.resolve(this.baseDir, clean);
    if (!target.startsWith(this.baseDir + path.sep)) {
      throw new Error("非法的存储路径");
    }
    return target;
  }

  async put(key: string, data: Uint8Array): Promise<void> {
    const target = this.resolveSafe(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data);
  }

  async get(key: string): Promise<StorageObject | null> {
    const target = this.resolveSafe(key);
    try {
      const buf = await readFile(target);
      return { data: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) };
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return null;
      throw e;
    }
  }

  async delete(key: string): Promise<void> {
    const target = this.resolveSafe(key);
    try {
      await unlink(target);
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") throw e;
    }
  }
}
