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
import { TagSelect } from '@/components/upload/TagSelect';

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

/** 本地草稿结构（localStorage，按 slug 隔离）。 */
interface EditDraft {
  title: string;
  summary: string;
  description: string;
  authorAlias: string;
  visibility: Visibility;
  screenshots: string[];
  tagIds: string[];
  /** ISO 8601 UTC */
  savedAt: string;
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
  const [tagIds, setTagIds] = React.useState<string[]>(project.tags.map((tag) => tag.id));
  const [busy, setBusy] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string>('');
  /** 是否已恢复本地草稿（未保存内容）。 */
  const [restored, setRestored] = React.useState<boolean>(false);
  const [draftSavedAt, setDraftSavedAt] = React.useState<string>('');

  const canSubmit = title.trim() !== '' && !busy;

  /** 本地草稿 key（按作品隔离）。 */
  const draftKey = `kernel-edit-draft:${project.slug}`;

  /* ---------- 草稿恢复（挂载时读 localStorage） ---------- */
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (!raw) return;
      const draft = JSON.parse(raw) as EditDraft;
      if (!draft || typeof draft.title !== 'string') return;
      setTitle(draft.title);
      setSummary(draft.summary);
      setDescription(draft.description);
      setAuthorAlias(draft.authorAlias);
      setVisibility(draft.visibility);
      setScreenshots(Array.isArray(draft.screenshots) ? draft.screenshots : []);
      setTagIds(Array.isArray(draft.tagIds) ? draft.tagIds : []);
      setDraftSavedAt(draft.savedAt ?? '');
      setRestored(true);
    } catch {
      // 忽略损坏的草稿
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- 自动保存（字段变化 debounce 600ms，跳过首次渲染） ---------- */
  const skipAutoSave = React.useRef(true);
  React.useEffect(() => {
    if (skipAutoSave.current) {
      skipAutoSave.current = false;
      return;
    }
    const timer = setTimeout(() => {
      try {
        const draft: EditDraft = { title, summary, description, authorAlias, visibility, screenshots, tagIds, savedAt: new Date().toISOString() };
        localStorage.setItem(draftKey, JSON.stringify(draft));
      } catch {
        // 存储不可用 / 超限时静默忽略（不影响编辑）
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [draftKey, title, summary, description, authorAlias, visibility, screenshots, tagIds]);

  /** 放弃草稿：清 localStorage 并还原作品原始值。 */
  function discardDraft(): void {
    try {
      localStorage.removeItem(draftKey);
    } catch {
      // ignore
    }
    setRestored(false);
    setDraftSavedAt('');
    setTitle(project.title);
    setSummary(project.summary ?? '');
    setDescription(project.description ?? '');
    setAuthorAlias(project.authorAlias ?? '');
    setVisibility(project.visibility as Visibility);
    setScreenshots(project.screenshots);
    setTagIds(project.tags.map((tag) => tag.id));
  }

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
        tagIds,
      });
      // 保存成功 → 清除本地草稿
      try {
        localStorage.removeItem(draftKey);
      } catch {
        // ignore
      }
      toast('已保存', 'success');
      router.push(`/w/${project.slug}`);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'NOT_LOGGED_IN') {
        // 会话过期：内容已自动保存到本地，登录回来自动恢复
        toast('登录已过期，编辑内容已自动保存，登录后将自动恢复', 'danger');
        router.push(`/login?next=/w/${encodeURIComponent(project.slug)}/edit`);
        return;
      }
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

      {restored ? (
        <div className="draft-banner" role="status">
          <span>
            已恢复上次未保存的内容
            {draftSavedAt ? `（${new Date(draftSavedAt).toLocaleString('zh-CN')}）` : ''}
            ，确认无误后保存
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={discardDraft}>
            放弃草稿
          </button>
        </div>
      ) : null}

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

        <Field label="标签" hint="选填，最多 5 个；便于在广场按标签筛选">
          <TagSelect value={tagIds} onChange={setTagIds} />
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
