'use client';

/**
 * 文件树。
 *
 * 递归渲染 `FileNode[]`，目录默认展开前两层 —— 再深就折叠，
 * 避免一个 2000 文件的项目把页面撑爆。
 */

import { useState } from 'react';

import { cn } from '@/lib/cn';
import { formatBytes } from '@/lib/format';
import type { FileNode } from '@/lib/types';

/** 组件属性。 */
export interface FileTreeProps {
  nodes: FileNode[];
  /** 入口文件路径，高亮显示。 */
  entryFile?: string;
  /** 默认展开的层级深度。 */
  defaultOpenDepth?: number;
}

/** 单个节点。 */
function TreeNode({
  node,
  depth,
  entryFile,
  defaultOpenDepth,
}: {
  node: FileNode;
  depth: number;
  entryFile: string;
  defaultOpenDepth: number;
}) {
  const [open, setOpen] = useState<boolean>(depth < defaultOpenDepth);
  const isEntry = !node.dir && node.path === entryFile;

  if (!node.dir) {
    return (
      <li className={cn('filetree__item', isEntry && 'is-entry')} style={{ paddingLeft: depth * 16 }}>
        <span className="filetree__icon" aria-hidden="true">
          ▪
        </span>
        <span className="filetree__name">{node.name}</span>
        {isEntry ? <span className="filetree__tag">入口</span> : null}
        <span className="filetree__size">{formatBytes(node.size)}</span>
      </li>
    );
  }

  return (
    <li className="filetree__group">
      <button
        type="button"
        className="filetree__item filetree__toggle"
        style={{ paddingLeft: depth * 16 }}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className="filetree__icon" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        <span className="filetree__name">{node.name}/</span>
        <span className="filetree__size">{formatBytes(node.size)}</span>
      </button>

      {open && node.children ? (
        <ul className="filetree__children">
          {node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              entryFile={entryFile}
              defaultOpenDepth={defaultOpenDepth}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** 渲染文件树。 */
export function FileTree({ nodes, entryFile = '', defaultOpenDepth = 2 }: FileTreeProps) {
  if (nodes.length === 0) {
    return <p className="filetree__empty">压缩包内没有可展示的文件</p>;
  }

  return (
    <ul className="filetree">
      {nodes.map((node) => (
        <TreeNode
          key={node.path}
          node={node}
          depth={0}
          entryFile={entryFile}
          defaultOpenDepth={defaultOpenDepth}
        />
      ))}
    </ul>
  );
}
