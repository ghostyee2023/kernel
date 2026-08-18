/**
 * QA 夹具脚本（仅测试用）：复制一个已存在的 PUBLIC 作品，生成一个 PRIVATE 副本，
 * 用于验证「越权访问 PRIVATE 作品 → 404」。
 */
import { PrismaClient } from '@prisma/client';
import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';

const prisma = new PrismaClient();
const DATA_ROOT = path.resolve(process.cwd(), process.env.KERNEL_DATA_DIR ?? './.kernel-data');

const SRC_SLUG = 'Aur9raFx';
const PRIVATE_SLUG = 'QaPriv01';

async function main() {
  const src = await prisma.project.findUnique({ where: { slug: SRC_SLUG } });
  if (!src) throw new Error(`源作品 ${SRC_SLUG} 不存在，请先 seed`);

  await prisma.project.deleteMany({ where: { slug: PRIVATE_SLUG } });

  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = src;
  await prisma.project.create({
    data: {
      ...rest,
      slug: PRIVATE_SLUG,
      title: '[QA] PRIVATE 夹具',
      visibility: 'PRIVATE',
    },
  });

  const srcDir = path.join(DATA_ROOT, 'projects', SRC_SLUG);
  const dstDir = path.join(DATA_ROOT, 'projects', PRIVATE_SLUG);
  await mkdir(path.dirname(dstDir), { recursive: true });
  await cp(srcDir, dstDir, { recursive: true, force: true });

  console.log(JSON.stringify({ ok: true, privateSlug: PRIVATE_SLUG, dstDir }, null, 2));
}

main()
  .catch((e) => {
    console.error('FIXTURE_FAILED:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
