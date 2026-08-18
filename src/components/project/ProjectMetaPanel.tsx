/**
 * 作品元信息面板（详情页右栏）。
 *
 * 「本地磁盘路径」一项仅在开发桩下展示，是这套本地实现的透明化调试入口；
 * ⬆️ 生产切对象存储后整行删除即可，不影响其它字段。
 */

import { MetaRow, SideCard } from '@/components/ui';
import { formatBytes, formatDateTime } from '@/lib/format';
import type { ProjectDTO } from '@/lib/types';

/** sourceType → 中文文案。 */
const SOURCE_LABEL: Record<string, string> = {
  ZIP: 'ZIP 压缩包',
  SINGLE_FILE: '单个 HTML',
  EXTERNAL_URL: '外部链接',
};

/** visibility → 中文文案。 */
const VISIBILITY_LABEL: Record<string, string> = {
  PUBLIC: '公开（展示在广场）',
  UNLISTED: '不公开（仅凭链接访问）',
  PRIVATE: '私密（仅自己可见）',
};

/** 组件属性。 */
export interface ProjectMetaPanelProps {
  project: ProjectDTO;
  /** 本地磁盘目录（仅本地桩透传）。 */
  dirPath?: string | null;
}

/** 渲染元信息面板。 */
export function ProjectMetaPanel({ project, dirPath }: ProjectMetaPanelProps) {
  return (
    <SideCard>
      <h3 className="side-card__title">作品信息</h3>

      <MetaRow label="短码" value={project.slug} mono />
      <MetaRow label="来源" value={SOURCE_LABEL[project.sourceType] ?? project.sourceType} />
      <MetaRow label="入口文件" value={project.entryFile || '—'} mono />
      <MetaRow label="文件数" value={`${project.fileCount} 个`} />
      <MetaRow label="体积" value={formatBytes(project.sizeBytes)} />
      <MetaRow label="可见性" value={VISIBILITY_LABEL[project.visibility] ?? project.visibility} />
      <MetaRow label="发布时间" value={formatDateTime(project.createdAt)} />
      <MetaRow label="到期时间" value={formatDateTime(project.expireAt)} />
      {project.purgeAt ? <MetaRow label="清除时间" value={formatDateTime(project.purgeAt)} /> : null}
      {dirPath ? <MetaRow label="本地目录" value={dirPath} mono /> : null}
    </SideCard>
  );
}
