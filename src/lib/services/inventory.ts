import type { Tx } from "@/lib/db";
import type { MovementType } from "@/generated/prisma/client";

export type MoveStockInput = {
  productId: string;
  warehouseId: string;
  /** 有符号数量：入库为正，出库为负 */
  quantity: number;
  type: MovementType;
  refType?: string;
  refId?: string;
  refNo?: string;
  memo?: string;
  userId?: string | null;
  locationId?: string | null;
};

/** 变更库存并写入库存流水，库存不足时抛错。必须在事务内调用。 */
export async function moveStock(tx: Tx, input: MoveStockInput) {
  if (!Number.isInteger(input.quantity) || input.quantity === 0) {
    throw new Error("库存变动数量必须为非零整数");
  }
  const inv = await tx.inventory.upsert({
    where: { productId_warehouseId: { productId: input.productId, warehouseId: input.warehouseId } },
    create: { productId: input.productId, warehouseId: input.warehouseId, quantity: 0, locationId: input.locationId ?? null },
    update: {},
  });
  const balance = inv.quantity + input.quantity;
  if (balance < 0) {
    const product = await tx.product.findUnique({ where: { id: input.productId } });
    throw new Error(`库存不足：「${product?.name ?? input.productId}」当前库存 ${inv.quantity}，需要 ${-input.quantity}`);
  }
  await tx.inventory.update({
    where: { id: inv.id },
    data: {
      quantity: balance,
      ...(input.locationId && !inv.locationId ? { locationId: input.locationId } : {}),
    },
  });
  await tx.stockMovement.create({
    data: {
      productId: input.productId,
      warehouseId: input.warehouseId,
      type: input.type,
      quantity: input.quantity,
      balance,
      refType: input.refType ?? null,
      refId: input.refId ?? null,
      refNo: input.refNo ?? null,
      memo: input.memo ?? null,
      userId: input.userId ?? null,
    },
  });
  return balance;
}

/** 预占库存（销售订单确认时），可用量 = 库存 - 已预占 */
export async function reserveStock(tx: Tx, productId: string, warehouseId: string, qty: number) {
  const inv = await tx.inventory.findUnique({
    where: { productId_warehouseId: { productId, warehouseId } },
    include: { product: true },
  });
  const available = inv ? inv.quantity - inv.reservedQty : 0;
  if (!inv || available < qty) {
    const name = inv?.product.name ?? (await tx.product.findUnique({ where: { id: productId } }))?.name;
    throw new Error(`可用库存不足：「${name ?? productId}」可用 ${available}，需要 ${qty}`);
  }
  await tx.inventory.update({ where: { id: inv.id }, data: { reservedQty: { increment: qty } } });
}

export async function releaseStock(tx: Tx, productId: string, warehouseId: string, qty: number) {
  const inv = await tx.inventory.findUnique({ where: { productId_warehouseId: { productId, warehouseId } } });
  if (!inv) return;
  await tx.inventory.update({
    where: { id: inv.id },
    data: { reservedQty: Math.max(0, inv.reservedQty - qty) },
  });
}

export async function transferStock(
  tx: Tx,
  input: { productId: string; fromWarehouseId: string; toWarehouseId: string; quantity: number; userId: string; memo?: string },
) {
  if (input.fromWarehouseId === input.toWarehouseId) throw new Error("调出仓库与调入仓库不能相同");
  if (input.quantity <= 0) throw new Error("调拨数量必须大于 0");
  const from = await tx.inventory.findUnique({
    where: { productId_warehouseId: { productId: input.productId, warehouseId: input.fromWarehouseId } },
  });
  if (!from || from.quantity - from.reservedQty < input.quantity) {
    throw new Error(`调出仓库可用库存不足（可用 ${from ? from.quantity - from.reservedQty : 0}）`);
  }
  const memo = input.memo ?? "库存调拨";
  await moveStock(tx, { productId: input.productId, warehouseId: input.fromWarehouseId, quantity: -input.quantity, type: "TRANSFER_OUT", refType: "transfer", memo, userId: input.userId });
  await moveStock(tx, { productId: input.productId, warehouseId: input.toWarehouseId, quantity: input.quantity, type: "TRANSFER_IN", refType: "transfer", memo, userId: input.userId });
}

/** 盘点调整：把库存直接调整为 newQuantity */
export async function adjustStock(
  tx: Tx,
  input: { productId: string; warehouseId: string; newQuantity: number; userId: string; memo?: string },
) {
  if (!Number.isInteger(input.newQuantity) || input.newQuantity < 0) throw new Error("盘点数量必须为非负整数");
  const inv = await tx.inventory.findUnique({
    where: { productId_warehouseId: { productId: input.productId, warehouseId: input.warehouseId } },
  });
  const current = inv?.quantity ?? 0;
  if (inv && input.newQuantity < inv.reservedQty) {
    throw new Error(`盘点数量不能低于已预占数量 ${inv.reservedQty}`);
  }
  const delta = input.newQuantity - current;
  if (delta === 0) return current;
  return moveStock(tx, {
    productId: input.productId,
    warehouseId: input.warehouseId,
    quantity: delta,
    type: "ADJUST",
    refType: "adjust",
    memo: input.memo ?? "盘点调整",
    userId: input.userId,
  });
}
