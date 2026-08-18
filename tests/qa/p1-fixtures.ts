/**
 * QA 夹具（P1 独立验证用）：基于 seed 作品复制出 ARCHIVED / PRIVATE / UNLISTED 三态作品，
 * 供投票 HTTP 层验证（404 / 410 / UNLISTED 可投）与前端 SSR 验证使用。
 *
 * 用法：node --env-file-if-exists=.env --import tsx tests/qa/p1-fixtures.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** 以 seed 作品为蓝本复制一条作品（改 slug/title/visibility/status）。 */
async function cloneProject(
  fromSlug: string,
  spec: { slug: string; title: string; visibility: string; status: string },
): Promise<{ id: string; slug: string }> {
  const src = await prisma.project.findUnique({ where: { slug: fromSlug } });
  if (!src) throw new Error(`源作品 ${fromSlug} 不存在，请先 seed`);

  await prisma.project.deleteMany({ where: { slug: spec.slug } });

  const { id: _id, slug: _s, createdAt: _c, updatedAt: _u, ...rest } = src;
  const created = await prisma.project.create({
    data: {
      ...rest,
      slug: spec.slug,
      title: spec.title,
      visibility: spec.visibility,
      status: spec.status,
      stats: { create: {} },
    },
    select: { id: true, slug: true },
  });
  return created;
}

async function main() {
  const arch = await cloneProject('NebuLa42', {
    slug: 'QaArch01',
    title: '[QA] ARCHIVED 夹具',
    visibility: 'PUBLIC',
    status: 'ARCHIVED',
  });
  const priv = await cloneProject('Aur9raFx', {
    slug: 'QaPriv01',
    title: '[QA] PRIVATE 夹具',
    visibility: 'PRIVATE',
    status: 'ACTIVE',
  });
  // UNLISTED 使用 seed 已有的 PuLse7Kd；这里仅确保存在
  const unlisted = await prisma.project.findUnique({
    where: { slug: 'PuLse7Kd' },
    select: { id: true, slug: true, visibility: true, status: true },
  });
  const pub = await prisma.project.findUnique({
    where: { slug: 'Aur9raFx' },
    select: { id: true, slug: true, visibility: true, status: true },
  });

  // 清空测试期间可能残留的票（保证幂等起点）
  await prisma.vote.deleteMany({});

  console.log(
    JSON.stringify(
      {
        ok: true,
        projects: {
          pub,
          unlisted,
          archived: arch,
          private: priv,
        },
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error('FIXTURE_FAILED:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
