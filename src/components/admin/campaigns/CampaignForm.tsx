'use client';

/**
 * 活动建/改表单（P1 活动模块）。
 *
 * 数据流：新建 → POST /api/admin/campaigns（成功后跳编辑页）；编辑 → PATCH
 * /api/admin/campaigns/:id（成功后 toast + refresh）。时间入参一律转 ISO 8601 UTC；
 * datetime-local 控件按浏览器本地时区展示/回写。
 */

import * as React from 'react';

import { useRouter } from 'next/navigation';

import { Button, Field, Input, Select, Textarea, useToast } from '@/components/ui';
import { CAMPAIGN_STATUS, MAX_VOTES_OPTIONS, type CampaignStatus } from '@/lib/constants';
import type { ApiEnvelope, CampaignDTO, CampaignInput } from '@/lib/types';

/** 活动状态选项。 */
const STATUS_OPTIONS: ReadonlyArray<{ value: CampaignStatus; label: string }> = [
  { value: CAMPAIGN_STATUS.DRAFT, label: '草稿' },
  { value: CAMPAIGN_STATUS.COLLECTING, label: '征集报名中' },
  { value: CAMPAIGN_STATUS.VOTING, label: '投票中' },
  { value: CAMPAIGN_STATUS.ENDED, label: '已结束' },
] as const;

/** 组件属性：`initial` 存在 = 编辑模式，否则新建。 */
export interface CampaignFormProps {
  /** 编辑模式下的活动 id（新建为 undefined）。 */
  campaignId?: string;
  /** 编辑模式下的初始数据。 */
  initial?: CampaignDTO;
}

/** 把 ISO 8601 UTC 转成 datetime-local 控件值（浏览器本地时区）。 */
function toLocalInputValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 把 datetime-local 控件值转成 ISO 8601 UTC；空串 → null。 */
function toIsoOrNull(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/** 渲染活动表单。 */
export function CampaignForm({ campaignId, initial }: CampaignFormProps): React.JSX.Element {
  const router = useRouter();
  const { toast } = useToast();

  const isEdit = campaignId !== undefined && initial !== undefined;

  const [title, setTitle] = React.useState<string>(initial?.title ?? '');
  const [slug, setSlug] = React.useState<string>(initial?.slug ?? '');
  const [description, setDescription] = React.useState<string>(initial?.description ?? '');
  const [collectEndAt, setCollectEndAt] = React.useState<string>(toLocalInputValue(initial?.collectEndAt));
  const [voteStartAt, setVoteStartAt] = React.useState<string>(toLocalInputValue(initial?.voteStartAt));
  const [voteEndAt, setVoteEndAt] = React.useState<string>(toLocalInputValue(initial?.voteEndAt));
  const [maxVotesPerUser, setMaxVotesPerUser] = React.useState<number>(initial?.maxVotesPerUser ?? 3);
  const [allowSelfVote, setAllowSelfVote] = React.useState<boolean>(initial?.allowSelfVote ?? true);
  const [voteWeight, setVoteWeight] = React.useState<number>(initial?.voteWeight ?? 1);
  const [status, setStatus] = React.useState<CampaignStatus>(initial?.storedStatus ?? CAMPAIGN_STATUS.DRAFT);
  const [busy, setBusy] = React.useState<boolean>(false);

  /** 组装入参（时间转 ISO UTC）。 */
  const buildInput = (): CampaignInput => ({
    title: title.trim(),
    slug: slug.trim() === '' ? undefined : slug.trim().toLowerCase(),
    description: description.trim() === '' ? null : description.trim(),
    collectEndAt: toIsoOrNull(collectEndAt),
    voteStartAt: toIsoOrNull(voteStartAt),
    voteEndAt: toIsoOrNull(voteEndAt),
    maxVotesPerUser,
    allowSelfVote,
    voteWeight,
    status,
  });

  /** 保存：新建走 POST，编辑走 PATCH。 */
  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    if (title.trim() === '') {
      toast('请填写活动标题', 'danger');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(isEdit ? `/api/admin/campaigns/${campaignId}` : '/api/admin/campaigns', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildInput()),
      });
      const body = (await response.json()) as ApiEnvelope<CampaignDTO>;
      if (!body.ok) {
        toast(body.error.message, 'danger');
        return;
      }
      if (isEdit) {
        toast('已保存活动', 'success');
        router.refresh();
      } else {
        toast('活动已创建，正在进入编辑页…', 'success');
        router.push(`/admin/campaigns/${body.data.id}/edit`);
      }
    } catch {
      toast('网络异常，请稍后重试', 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="publish-form" onSubmit={(event) => void submit(event)}>
      <Field label="活动标题" required htmlFor="camp-title">
        <Input
          id="camp-title"
          value={title}
          maxLength={60}
          placeholder="例如：Kernel 夏日创意种子征集"
          onChange={(event) => setTitle(event.target.value)}
        />
      </Field>

      <Field
        label="活动短码 slug"
        htmlFor="camp-slug"
        hint="留空自动生成 camp-xxxxxx；格式：小写字母/数字 + 连字符（2-32 位）"
      >
        <Input
          id="camp-slug"
          value={slug}
          maxLength={32}
          placeholder="camp-demo1"
          onChange={(event) => setSlug(event.target.value)}
        />
      </Field>

      <Field label="活动简介" htmlFor="camp-desc" hint={`最多 2000 字；换行会原样展示`}>
        <Textarea
          id="camp-desc"
          value={description}
          rows={4}
          maxLength={2000}
          placeholder="活动主题、规则说明、参与方式…"
          onChange={(event) => setDescription(event.target.value)}
        />
      </Field>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        <Field label="报名截止" htmlFor="camp-collect-end">
          <Input
            id="camp-collect-end"
            type="datetime-local"
            value={collectEndAt}
            onChange={(event) => setCollectEndAt(event.target.value)}
          />
        </Field>
        <Field label="投票开始" htmlFor="camp-vote-start" hint="可空，空视为与报名截止同刻">
          <Input
            id="camp-vote-start"
            type="datetime-local"
            value={voteStartAt}
            onChange={(event) => setVoteStartAt(event.target.value)}
          />
        </Field>
        <Field label="投票结束" htmlFor="camp-vote-end">
          <Input
            id="camp-vote-end"
            type="datetime-local"
            value={voteEndAt}
            onChange={(event) => setVoteEndAt(event.target.value)}
          />
        </Field>
      </div>

      <Field label="每人限投" htmlFor="camp-max-votes" hint="同一活动内跨作品累计">
        <Select
          id="camp-max-votes"
          value={String(maxVotesPerUser)}
          onChange={(event) => setMaxVotesPerUser(Number(event.target.value))}
        >
          {MAX_VOTES_OPTIONS.map((value) => (
            <option key={value} value={String(value)}>
              {value} 票
            </option>
          ))}
        </Select>
      </Field>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
        <Field label="允许给自己投票" htmlFor="camp-self-vote">
          <Select
            id="camp-self-vote"
            value={allowSelfVote ? 'true' : 'false'}
            onChange={(event) => setAllowSelfVote(event.target.value === 'true')}
          >
            <option value="true">允许</option>
            <option value="false">不允许</option>
          </Select>
        </Field>
        <Field label="评委加权" htmlFor="camp-weight" hint="本轮恒 1，字段落库供后续">
          <Input
            id="camp-weight"
            type="number"
            min={1}
            max={9}
            value={String(voteWeight)}
            onChange={(event) => setVoteWeight(Math.max(1, Number(event.target.value) || 1))}
          />
        </Field>
      </div>

      <Field label="状态推进" htmlFor="camp-status" hint="状态会随时间窗懒计算自动推进（如到 voteEndAt 自动结束）">
        <Select id="camp-status" value={status} onChange={(event) => setStatus(event.target.value as CampaignStatus)}>
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>

      <div className="publish-form__actions">
        <Button type="button" variant="ghost" disabled={busy} onClick={() => router.back()}>
          取消
        </Button>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? '保存中…' : isEdit ? '保存修改' : '创建活动'}
        </Button>
      </div>
    </form>
  );
}
