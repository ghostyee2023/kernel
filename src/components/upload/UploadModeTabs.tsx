'use client';

/**
 * 上传方式选择。
 *
 * 三选一用 `role="radiogroup"` 语义，键盘可达；视觉上是三张卡片。
 */

import { RadioCard } from '@/components/ui';
import type { UploadMode } from '@/lib/constants';

/** 组件属性。 */
export interface UploadModeTabsProps {
  value: UploadMode;
  onChange: (mode: UploadMode) => void;
  /** 已选好文件后锁定，避免切换模式导致状态错乱。 */
  disabled?: boolean;
}

/** 三种模式的展示配置。 */
const MODES: Array<{ value: UploadMode; title: string; desc: string }> = [
  { value: 'ZIP', title: 'ZIP 压缩包', desc: '多文件项目，需包含 index.html' },
  { value: 'SINGLE_FILE', title: '单个 HTML', desc: '一个自包含的 .html 文件' },
  { value: 'EXTERNAL_URL', title: '外部链接', desc: '作品已托管在其它地方' },
];

/** 渲染模式选择卡片组。 */
export function UploadModeTabs({ value, onChange, disabled = false }: UploadModeTabsProps) {
  return (
    <div className="radio-cards" role="radiogroup" aria-label="上传方式">
      {MODES.map((mode) => (
        <RadioCard
          key={mode.value}
          title={mode.title}
          desc={mode.desc}
          active={value === mode.value}
          disabled={disabled}
          onClick={() => onChange(mode.value)}
        />
      ))}
    </div>
  );
}
