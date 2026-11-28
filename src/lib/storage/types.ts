export interface StorageObject {
  data: Uint8Array;
  contentType?: string;
}

/** 可插拔对象存储接口（本地磁盘 / S3 兼容存储统一实现） */
export interface StorageDriver {
  readonly kind: "local" | "s3";
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<StorageObject | null>;
  /** 只读一段（[start, end]，含 end）；没有实现的驱动整份读取后切片 */
  readRange?(key: string, range: (size: number) => { start: number; end: number } | null): Promise<{ size: number; data: Uint8Array | null } | null>;
  delete(key: string): Promise<void>;
}
