'use client';

/**
 * TagSelect —— 标签多选（后台预置库，≤MAX_PROJECT_TAGS 个）。
 *
 * 数据源：GET /api/tags（公开列表，含活动标签），挂载时拉取。
 * 交互：chip 点击 toggle；选中高亮（aria-pressed）；满上限时未选中项禁用。
 */

import * as React from 'react';

import type { TagDTO } from '@/lib/types';
import { MAX_PROJECT_TAGS } from '@/lib/constants';

/** 组件属性。 */
export interface TagSelectProps {
  /** 已选标签 id 数组（受控）。 */
  value: string[];
  /** 变更回调。 */
  onChange: (next: string[]) => void;
}

/** 渲染标签多选。 */
export function TagSelect({ value, onChange }: TagSelectProps): React.JSX.Element {
  const [tags, setTags] = React.useState<TagDTO[]>([]);
  const [loaded, setLoaded] = React.useState<boolean>(false);

  React.useEffect(() => {
    let cancelled = false;
    void fetch('/api/tags')
      .then((res) => res.json())
      .then((body) => {
        if (cancelled) return;
        if (body?.ok && Array.isArray(body.data)) setTags(body.data as TagDTO[]);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const full = value.length >= MAX_PROJECT_TAGS;

  /** 切换选中。 */
  function toggle(id: string): void {
    if (value.includes(id)) {
      onChange(value.filter((item) => item !== id));
    } else if (!full) {
      onChange([...value, id]);
    }
  }

  return (
    <div className="tag-select" role="group" aria-label="选择标签">
      {!loaded ? (
        <p className="hint">标签加载中…</p>
      ) : tags.length === 0 ? (
        <p className="hint">还没有可用标签，请先在后台添加。</p>
      ) : (
        <div className="chips">
          {tags.map((tag) => {
            const selected = value.includes(tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                className="chip"
                aria-pressed={selected}
                disabled={!selected && full}
                title={selected ? '点击取消' : '点击添加'}
                onClick={() => toggle(tag.id)}
              >
                {tag.name}
                {tag.kind === 'activity' ? ' · 活动' : ''}
              </button>
            );
          })}
        </div>
      )}
      <p className="hint">
        已选 {value.length}/{MAX_PROJECT_TAGS} 个
        {full ? '（已达上限）' : ''}
      </p>
    </div>
  );
}
