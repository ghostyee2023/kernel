'use client';

/**
 * 发布信息表单。
 *
 * 校验规则与服务端 `project-service.create()` 保持同源常量（`lib/constants.ts`），
 * 前端只做即时反馈，服务端仍会再校验一次 —— 前端校验是体验，不是安全边界。
 */

import { useMemo, useState } from 'react';

import { Button, Field, Input, RadioCard, Select, Textarea } from '@/components/ui';
import {
  DEFAULT_TTL_DAYS,
  MAX_AUTHOR_ALIAS_LEN,
  MAX_DESCRIPTION_LEN,
  MAX_SUMMARY_LEN,
  MAX_TITLE_LEN,
  TTL_OPTIONS,
  type Visibility,
} from '@/lib/constants';
import type { FileNode, ValidatedUpload } from '@/lib/types';

import { ScreenshotUploader } from './ScreenshotUploader';

/** 表单值。 */
export interface PublishFormValue {
  title: string;
  summary: string;
  description: string;
  authorAlias: string;
  visibility: Visibility;
  ttlDays: number;
  entryFile: string;
  /** 作品截图文件名数组。 */
  screenshots: string[];
}

/** 组件属性。 */
export interface PublishFormProps {
  /** ZIP / 单文件模式下的校验结果，用于提供入口文件候选。 */
  validated?: ValidatedUpload | null;
  /** 外链模式下的地址（只读展示）。 */
  externalUrl?: string;
  /** 提交回调。 */
  onSubmit: (value: PublishFormValue) => void;
  /** 返回上一步。 */
  onBack: () => void;
  /** 提交中。 */
  submitting?: boolean;
}

/** 可见性选项。 */
const VISIBILITY_OPTIONS: Array<{ value: Visibility; title: string; desc: string }> = [
  { value: 'PUBLIC', title: '公开', desc: '展示在作品广场，所有人可见' },
  { value: 'UNLISTED', title: '不公开', desc: '不进广场，凭链接可访问' },
  { value: 'PRIVATE', title: '私密', desc: '仅自己可见，链接也打不开' },
];

/** 收集文件树中的全部 HTML 文件，作为入口候选。 */
function collectHtmlFiles(nodes: FileNode[]): string[] {
  const out: string[] = [];
  const walk = (list: FileNode[]): void => {
    for (const node of list) {
      if (node.dir) {
        walk(node.children ?? []);
      } else if (/\.html?$/i.test(node.path)) {
        out.push(node.path);
      }
    }
  };
  walk(nodes);
  return out;
}

/** 渲染发布表单。 */
export function PublishForm({
  validated = null,
  externalUrl,
  onSubmit,
  onBack,
  submitting = false,
}: PublishFormProps) {
  const [value, setValue] = useState<PublishFormValue>({
    title: '',
    summary: '',
    description: '',
    authorAlias: '',
    visibility: 'PUBLIC',
    ttlDays: DEFAULT_TTL_DAYS,
    entryFile: validated?.entryFileSuggested ?? '',
    screenshots: [],
  });
  const [touched, setTouched] = useState<boolean>(false);

  const htmlCandidates = useMemo(
    () => (validated ? collectHtmlFiles(validated.fileTree) : []),
    [validated],
  );

  const titleError = touched && value.title.trim() === '' ? '请填写作品标题' : null;
  const canSubmit = value.title.trim() !== '' && !submitting;

  /** 局部更新表单值。 */
  const update = <K extends keyof PublishFormValue>(key: K, next: PublishFormValue[K]): void => {
    setValue((prev) => ({ ...prev, [key]: next }));
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setTouched(true);
    if (value.title.trim() === '') return;
    onSubmit(value);
  };

  return (
    <form className="publish-form" onSubmit={handleSubmit} noValidate>
      <Field label="作品标题" htmlFor="pf-title" required error={titleError} hint={`最多 ${MAX_TITLE_LEN} 字`}>
        <Input
          id="pf-title"
          value={value.title}
          maxLength={MAX_TITLE_LEN}
          placeholder="给你的作品起个名字"
          invalid={Boolean(titleError)}
          onChange={(event) => update('title', event.target.value)}
          onBlur={() => setTouched(true)}
        />
      </Field>

      <Field label="一句话简介" htmlFor="pf-summary" hint={`展示在广场卡片上，最多 ${MAX_SUMMARY_LEN} 字`}>
        <Input
          id="pf-summary"
          value={value.summary}
          maxLength={MAX_SUMMARY_LEN}
          placeholder="用一句话说清楚它是什么"
          onChange={(event) => update('summary', event.target.value)}
        />
      </Field>

      <Field label="详细介绍" htmlFor="pf-desc" hint={`选填，最多 ${MAX_DESCRIPTION_LEN} 字`}>
        <Textarea
          id="pf-desc"
          rows={5}
          value={value.description}
          maxLength={MAX_DESCRIPTION_LEN}
          placeholder="创作思路、技术栈、使用说明…"
          onChange={(event) => update('description', event.target.value)}
        />
      </Field>

      <Field label="作品截图" hint="选填，最多 9 张；可裁剪，第一张作为封面">
        <ScreenshotUploader value={value.screenshots} onChange={(next) => update('screenshots', next)} />
      </Field>

      <Field label="作者署名" htmlFor="pf-alias" hint={`选填，留空则显示为「本地创作者」，最多 ${MAX_AUTHOR_ALIAS_LEN} 字`}>
        <Input
          id="pf-alias"
          value={value.authorAlias}
          maxLength={MAX_AUTHOR_ALIAS_LEN}
          placeholder="你的昵称"
          onChange={(event) => update('authorAlias', event.target.value)}
        />
      </Field>

      {externalUrl ? (
        <Field label="外链地址" htmlFor="pf-url" hint="已在上一步校验通过">
          <Input id="pf-url" value={externalUrl} readOnly />
        </Field>
      ) : null}

      {htmlCandidates.length > 1 ? (
        <Field label="入口文件" htmlFor="pf-entry" hint="访问作品时首先打开的页面">
          <Select
            id="pf-entry"
            value={value.entryFile}
            onChange={(event) => update('entryFile', event.target.value)}
          >
            {htmlCandidates.map((file) => (
              <option key={file} value={file}>
                {file}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}

      <Field label="可见性" hint="发布后可以随时修改">
        <div className="radio-cards" role="radiogroup" aria-label="可见性">
          {VISIBILITY_OPTIONS.map((option) => (
            <RadioCard
              key={option.value}
              title={option.title}
              desc={option.desc}
              active={value.visibility === option.value}
              onClick={() => update('visibility', option.value)}
            />
          ))}
        </div>
      </Field>

      <Field label="有效期" hint="到期后进入回收站，30 天内可随时恢复">
        <div className="chips" role="radiogroup" aria-label="保留时长">
          {TTL_OPTIONS.map((days) => (
            <button
              key={days}
              type="button"
              className="chip"
              aria-pressed={value.ttlDays === days}
              onClick={() => update('ttlDays', days)}
            >
              {days} 天
            </button>
          ))}
          <button type="button" className="chip" disabled title="P0 暂不支持永久保留，需管理员批准">
            永久 · 需管理员批准
          </button>
        </div>
      </Field>

      <div className="publish-form__actions">
        <Button type="button" variant="ghost" onClick={onBack} disabled={submitting}>
          上一步
        </Button>
        <Button type="submit" disabled={!canSubmit}>
          {submitting ? '发布中…' : '确认发布'}
        </Button>
      </div>
    </form>
  );
}
