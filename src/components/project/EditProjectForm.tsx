'use client';

/**
 * EditProjectForm —— 作品编辑表单。
 *
 * 复用发布表单同款 Field/Input/RadioCard 组件与样式（publish-form），
 * 预填当前值；提交走 PATCH /api/projects/{slug}（作者或管理员）。
 * 支持编辑：标题 / 简介 / 详细介绍 / 作者署名 / 可见性 / 截图（增删、可裁剪）。
 */

import * as React from 'react';

import { useRouter } from 'next/navigation';

import { Button, Field, Input, RadioCard, Textarea, useToast } from '@/components/ui';
import {
  MAX_AUTHOR_ALIAS_LEN,
  MAX_DESCRIPTION_LEN,
  MAX_SUMMARY_LEN,
  MAX_TITLE_LEN,
  type Visibility,
} from '@/lib/constants';
import type { ProjectDTO } from '@/lib/types';
import { ApiError, patchProject } from '@/lib/upload-client';

import { ScreenshotUploader } from '@/components/upload/ScreenshotUploader';

/** 可见性选项（与发布表单一致）。 */
const VISIBILITY_OPTIONS: Array<{ value: Visibility; title: string; desc: string }> = [
  { value: 'PUBLIC', title: '公开', desc: '展示在作品广场，所有人可见' },
  { value: 'UNLISTED', title: '不公开', desc: '不进广场，凭链接可访问' },
  { value: 'PRIVATE', title: '私密', desc: '仅自己可见，链接也打不开' },
];

/** 组件属性。 */
export interface EditProjectFormProps {
  /** SSR 注入的当前作品。 */
  project: ProjectDTO;
}

/** 渲染编辑表单。 */
export function EditProjectForm({ project }: EditProjectFormProps): React.JSX.Element {
  const router = useRouter();
  const { toast } = useToast();

  const [title, setTitle] = React.useState<string>(project.title);
  const [summary, setSummary] = React.useState<string>(project.summary ?? '');
  const [description, setDescription] = React.useState<string>(project.description ?? '');
  const [authorAlias, setAuthorAlias] = React.useState<string>(project.authorAlias ?? '');
  const [visibility, setVisibility] = React.useState<Visibility>(project.visibility as Visibility);
  const [screenshots, setScreenshots] = React.useState<string[]>(project.screenshots);
  const [busy, setBusy] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string>('');

  const canSubmit = title.trim() !== '' && !busy;

  /** 提交编辑。 */
  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (title.trim() === '') return;
    setBusy(true);
    setError('');
    try {
      await patchProject(project.slug, {
        title: title.trim(),
        summary: summary.trim() || undefined,
        description: description.trim() || undefined,
        authorAlias: authorAlias.trim() || undefined,
        visibility,
        screenshots,
      });
      toast('已保存', 'success');
      router.push(`/w/${project.slug}`);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        const parsed = err as { code?: string; message?: string };
        setError(parsed?.message ?? '保存失败，请重试');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container-prose publish-page">
      <header className="publish-page__head">
        <h1 className="t-display-lg">编辑作品</h1>
        <p className="muted">
          修改后立即生效；截图第一张作为封面，最多 9 张。
        </p>
      </header>

      <form className="publish-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
        <Field label="作品标题" htmlFor="ef-title" required hint={`最多 ${MAX_TITLE_LEN} 字`}>
          <Input
            id="ef-title"
            value={title}
            maxLength={MAX_TITLE_LEN}
            placeholder="给你的作品起个名字"
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>

        <Field label="一句话简介" htmlFor="ef-summary" hint={`展示在广场卡片上，最多 ${MAX_SUMMARY_LEN} 字`}>
          <Input
            id="ef-summary"
            value={summary}
            maxLength={MAX_SUMMARY_LEN}
            placeholder="用一句话说清楚它是什么"
            onChange={(event) => setSummary(event.target.value)}
          />
        </Field>

        <Field label="详细介绍" htmlFor="ef-desc" hint={`选填，最多 ${MAX_DESCRIPTION_LEN} 字`}>
          <Textarea
            id="ef-desc"
            rows={5}
            value={description}
            maxLength={MAX_DESCRIPTION_LEN}
            placeholder="创作思路、技术栈、使用说明…"
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>

        <Field label="作品截图" hint="可裁剪，第一张作为封面，最多 9 张">
          <ScreenshotUploader value={screenshots} onChange={setScreenshots} />
        </Field>

        <Field label="作者署名" htmlFor="ef-alias" hint={`选填，留空则显示为「本地创作者」，最多 ${MAX_AUTHOR_ALIAS_LEN} 字`}>
          <Input
            id="ef-alias"
            value={authorAlias}
            maxLength={MAX_AUTHOR_ALIAS_LEN}
            placeholder="你的昵称"
            onChange={(event) => setAuthorAlias(event.target.value)}
          />
        </Field>

        <Field label="可见性" hint="私密作品链接打不开，仅作者在个人空间可见">
          <div className="radio-cards" role="radiogroup" aria-label="可见性">
            {VISIBILITY_OPTIONS.map((option) => (
              <RadioCard
                key={option.value}
                title={option.title}
                desc={option.desc}
                active={visibility === option.value}
                onClick={() => setVisibility(option.value)}
              />
            ))}
          </div>
        </Field>

        {error ? (
          <p className="auth-err show" role="alert" style={{ margin: '0 0 12px' }}>
            {error}
          </p>
        ) : null}

        <div className="publish-form__actions">
          <Button type="button" variant="ghost" disabled={busy} onClick={() => router.push(`/w/${project.slug}`)}>
            取消
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            {busy ? '保存中…' : '保存修改'}
          </Button>
        </div>
      </form>
    </div>
  );
}
