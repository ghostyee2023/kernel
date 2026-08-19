'use client';

/**
 * 后台标签管理（P3 标签系统）—— 自包含 client 组件。
 *
 * 能力：
 *   - 列表：名称 / slug / 类型（自定义 · 活动）/ 排序 / 作品数；
 *   - 新建自定义标签（POST /api/admin/tags）；
 *   - 改名（PATCH /api/admin/tags/:id，仅 custom）；
 *   - 排序：上移 / 下移（POST :id/reorder，返回新列表）；
 *   - 删除（DELETE /api/admin/tags/:id，仅 custom；带二次确认）；
 *   - 标签作品管理：点击「作品」→ 拉取该标签下作品 → 展示列表 + 解除关联。
 */

import * as React from 'react';

import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { Badge, Button, Input, Table, TBody, Td, Th, THead, Tr, useToast } from '@/components/ui';
import type { AdminTagDTO } from '@/lib/types';

/** 标签作品条目（与后端 listTagProjects 对齐）。 */
interface TagProject {
  id: string;
  slug: string;
  title: string;
  status: string;
}

/** 请求信封最小结构。 */
interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string };
}

/** 渲染后台标签管理。 */
export function TagsManager(): React.JSX.Element {
  const { toast } = useToast();
  const [tags, setTags] = React.useState<AdminTagDTO[]>([]);
  const [loading, setLoading] = React.useState<boolean>(true);
  const [busy, setBusy] = React.useState<boolean>(false);
  const [newName, setNewName] = React.useState<string>('');
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editName, setEditName] = React.useState<string>('');
  /** 删除确认。 */
  const [confirmDelete, setConfirmDelete] = React.useState<AdminTagDTO | null>(null);
  /** 标签作品管理面板。 */
  const [projectsOf, setProjectsOf] = React.useState<AdminTagDTO | null>(null);
  const [tagProjects, setTagProjects] = React.useState<TagProject[]>([]);
  const [projectsLoading, setProjectsLoading] = React.useState<boolean>(false);

  /** 拉取标签列表。 */
  const load = React.useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/tags');
      const body = (await res.json()) as Envelope<AdminTagDTO[]>;
      if (!body.ok) {
        toast(body.error?.message ?? '加载失败', 'danger');
        return;
      }
      setTags(body.data ?? []);
    } catch {
      toast('网络异常，请稍后重试', 'danger');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  React.useEffect(() => {
    void load();
  }, [load]);

  /** 创建标签。 */
  async function createTag(): Promise<void> {
    const name = newName.trim();
    if (name === '') return;
    setBusy(true);
    try {
      const res = await fetch('/api/admin/tags', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const body = (await res.json()) as Envelope<AdminTagDTO>;
      if (!body.ok) {
        toast(body.error?.message ?? '创建失败', 'danger');
        return;
      }
      setNewName('');
      toast('标签已创建', 'success');
      void load();
    } catch {
      toast('网络异常，请稍后重试', 'danger');
    } finally {
      setBusy(false);
    }
  }

  /** 提交改名。 */
  async function submitRename(id: string): Promise<void> {
    const name = editName.trim();
    if (name === '') return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/tags/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const body = (await res.json()) as Envelope<AdminTagDTO>;
      if (!body.ok) {
        toast(body.error?.message ?? '改名失败', 'danger');
        return;
      }
      setEditingId(null);
      toast('已改名', 'success');
      void load();
    } catch {
      toast('网络异常，请稍后重试', 'danger');
    } finally {
      setBusy(false);
    }
  }

  /** 排序（上移/下移）。 */
  async function reorder(id: string, direction: 'up' | 'down'): Promise<void> {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/tags/${id}/reorder`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ direction }),
      });
      const body = (await res.json()) as Envelope<AdminTagDTO[]>;
      if (!body.ok) {
        toast(body.error?.message ?? '排序失败', 'danger');
        return;
      }
      setTags(body.data ?? []);
    } catch {
      toast('网络异常，请稍后重试', 'danger');
    } finally {
      setBusy(false);
    }
  }

  /** 执行删除（仅 custom）。 */
  async function doDelete(id: string): Promise<void> {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/tags/${id}`, { method: 'DELETE' });
      const body = (await res.json()) as Envelope<{ deleted: boolean }>;
      if (!body.ok) {
        toast(body.error?.message ?? '删除失败', 'danger');
        return;
      }
      toast('标签已删除', 'success');
      void load();
    } catch {
      toast('网络异常，请稍后重试', 'danger');
    } finally {
      setBusy(false);
      setConfirmDelete(null);
    }
  }

  /** 打开标签作品面板。 */
  async function openProjects(tag: AdminTagDTO): Promise<void> {
    setProjectsOf(tag);
    setTagProjects([]);
    setProjectsLoading(true);
    try {
      const res = await fetch(`/api/admin/tags/${tag.id}/projects`);
      const body = (await res.json()) as Envelope<TagProject[]>;
      setTagProjects(body.ok ? (body.data ?? []) : []);
    } catch {
      setTagProjects([]);
    } finally {
      setProjectsLoading(false);
    }
  }

  /** 解除作品关联。 */
  async function unlink(tag: AdminTagDTO, projectId: string): Promise<void> {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/tags/${tag.id}/projects/${projectId}`, { method: 'DELETE' });
      const body = (await res.json()) as Envelope<{ removed: boolean }>;
      if (!body.ok) {
        toast(body.error?.message ?? '解除失败', 'danger');
        return;
      }
      setTagProjects((prev) => prev.filter((item) => item.id !== projectId));
      toast('已解除关联', 'success');
      void load();
    } catch {
      toast('网络异常，请稍后重试', 'danger');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-tags">
      {/* 新建 */}
      <div className="admin-filter-bar" style={{ marginBottom: 12 }}>
        <Input
          className="admin-filter-bar__q"
          placeholder="新标签名（最多 12 字）"
          maxLength={12}
          value={newName}
          disabled={busy}
          onChange={(event) => setNewName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void createTag();
          }}
        />
        <Button size="sm" disabled={busy || newName.trim() === ''} onClick={() => void createTag()}>
          新建标签
        </Button>
        <span className="t-body-sm muted">活动会自动同步为标签（类型=活动，不可删改）</span>
      </div>

      <div className="admin-table-scroll">
        <Table>
          <THead>
            <Tr>
              <Th className="admin-table__num">排序</Th>
              <Th>标签名</Th>
              <Th>slug</Th>
              <Th>类型</Th>
              <Th className="admin-table__num">作品数</Th>
              <Th className="admin-table__actions">操作</Th>
            </Tr>
          </THead>
          <TBody>
            {loading ? (
              <Tr>
                <Td colSpan={6} className="admin-table__empty">
                  加载中…
                </Td>
              </Tr>
            ) : tags.length === 0 ? (
              <Tr>
                <Td colSpan={6} className="admin-table__empty">
                  还没有标签，先在上方新建一个。
                </Td>
              </Tr>
            ) : (
              tags.map((tag, index) => {
                const isActivity = tag.kind === 'activity';
                return (
                  <Tr key={tag.id}>
                    <Td className="admin-table__num">
                      <span className="mono">{index + 1}</span>
                    </Td>
                    <Td>
                      {editingId === tag.id ? (
                        <div className="admin-inline-edit">
                          <Input
                            value={editName}
                            maxLength={12}
                            disabled={busy}
                            onChange={(event) => setEditName(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') void submitRename(tag.id);
                              if (event.key === 'Escape') setEditingId(null);
                            }}
                          />
                          <Button size="sm" disabled={busy} onClick={() => void submitRename(tag.id)}>
                            保存
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                            取消
                          </Button>
                        </div>
                      ) : (
                        <span className="admin-table__title" title={tag.name}>
                          {tag.name}
                        </span>
                      )}
                    </Td>
                    <Td>
                      <span className="mono t-body-sm">{tag.slug}</span>
                    </Td>
                    <Td>
                      <Badge tone={isActivity ? 'campaign' : 'info'}>{isActivity ? '活动' : '自定义'}</Badge>
                    </Td>
                    <Td className="admin-table__num">
                      <span className="mono">{tag.projectCount}</span>
                    </Td>
                    <Td className="admin-table__actions">
                      <div className="admin-row-actions">
                        {!isActivity ? (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy || editingId !== null}
                              onClick={() => {
                                setEditingId(tag.id);
                                setEditName(tag.name);
                              }}
                            >
                              改名
                            </Button>
                            <Button
                              size="sm"
                              variant="danger"
                              disabled={busy}
                              onClick={() => setConfirmDelete(tag)}
                            >
                              删除
                            </Button>
                          </>
                        ) : null}
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void openProjects(tag)}>
                          作品
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy || index === 0}
                          title="上移"
                          onClick={() => void reorder(tag.id, 'up')}
                        >
                          ↑
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy || index === tags.length - 1}
                          title="下移"
                          onClick={() => void reorder(tag.id, 'down')}
                        >
                          ↓
                        </Button>
                      </div>
                    </Td>
                  </Tr>
                );
              })
            )}
          </TBody>
        </Table>
      </div>

      {/* 删除确认 */}
      {confirmDelete ? (
        <ConfirmDialog
          open
          title="删除标签"
          description={`将删除「${confirmDelete.name}」及其与所有作品的关联，不可恢复。`}
          danger
          confirmText="确认删除"
          busy={busy}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => void doDelete(confirmDelete.id)}
        />
      ) : null}

      {/* 标签作品管理 */}
      {projectsOf ? (
        <div className="cropper-modal" role="dialog" aria-modal="true" aria-label={`「${projectsOf.name}」标签的作品`}>
          <div className="cropper-modal__panel" style={{ maxHeight: '70vh', overflow: 'auto' }}>
            <div className="admin-panel-head">
              <div>
                <h3 className="t-title">「{projectsOf.name}」标签下的作品</h3>
                <p className="muted t-body-sm">共 {tagProjects.length} 件；解除关联不会删除作品本身。</p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setProjectsOf(null)}>
                关闭
              </Button>
            </div>
            {projectsLoading ? (
              <p className="hint">加载中…</p>
            ) : tagProjects.length === 0 ? (
              <p className="hint">该标签下还没有作品。</p>
            ) : (
              <div className="admin-tag-projects">
                {tagProjects.map((item) => (
                  <div key={item.id} className="admin-tag-project">
                    <div className="admin-tag-project__info">
                      <span className="admin-table__title">{item.title}</span>
                      <span className="mono t-body-sm muted">{item.slug}</span>
                      <Badge tone={item.status === 'ACTIVE' ? 'live' : 'archived'}>
                        {item.status === 'ACTIVE' ? '在线' : '已归档'}
                      </Badge>
                    </div>
                    <Button size="sm" variant="danger" disabled={busy} onClick={() => void unlink(projectsOf, item.id)}>
                      解除关联
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
