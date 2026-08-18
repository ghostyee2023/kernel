/**
 * 审计日志写入 —— **全站写 AuditLog 的唯一入口**（P2 后台模块）。
 *
 * 与 `lifecycle.writeLog` 同构的容错姿势：
 *   - `meta` 序列化（JSON.stringify）收敛在本函数内，调用点只传对象；
 *   - 写入失败**不阻断主流程**，仅 `console.warn`（审计是增强能力，不是强依赖）。
 *
 * 约定（docs/P2-后台管理设计.md §7.2）：
 *   - action 命名：`admin.{domain}.{action}`（如 `admin.project.block`）；
 *   - targetType：`project | user | cleanup`；
 *   - targetId：project 用 Project.id、user 用 User.id、cleanup 用 batchId；
 *   - meta 快照：`{ before, after, ... }`，读侧未来审计页用 `JSON.parse`。
 */

import { prisma } from './prisma';
import type { AuditLogInput } from './types';

/**
 * 写入一条审计日志。
 *
 * @param params 审计入参（detail 为人读摘要；meta 为结构化快照，序列化收敛于此）。
 * @returns 恒 void；任何失败仅告警，不抛出。
 */
export async function writeAudit(params: AuditLogInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: params.actorId,
        action: params.action,
        targetType: params.targetType,
        targetId: params.targetId,
        detail: params.detail ?? null,
        meta: params.meta === undefined ? null : JSON.stringify(params.meta),
        ip: params.ip ?? null,
      },
    });
  } catch (error) {
    console.warn(
      `[audit][write] action=${params.action} target=${params.targetType}:${params.targetId} actor=${params.actorId}`,
      error,
    );
  }
}
