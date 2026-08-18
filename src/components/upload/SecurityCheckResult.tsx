'use client';

/**
 * 安全检查结果面板。
 *
 * 把服务端做过的事一条条摊开给用户看 —— 「平台替你做了什么」比一句
 * 「上传成功」更能建立信任，也让被忽略的文件有据可查。
 */

import { formatBytes } from '@/lib/format';
import type { ValidatedUpload } from '@/lib/types';

import { FileTree } from './FileTree';

/** 组件属性。 */
export interface SecurityCheckResultProps {
  result: ValidatedUpload;
}

/** 忽略原因 → 中文文案。 */
const IGNORE_REASON: Record<string, string> = {
  EXTENSION_NOT_ALLOWED: '文件类型不在白名单内',
  IGNORED_DIRECTORY: '属于被忽略的目录',
  IGNORED_FILE: '系统生成的无关文件',
  EMPTY_PATH: '路径为空',
  SYMLINK: '符号链接（存在安全风险）',
};

/** 渲染安全检查结果。 */
export function SecurityCheckResult({ result }: SecurityCheckResultProps) {
  const checks: string[] = [
    '文件真实类型校验通过（按二进制魔数识别，不看扩展名）',
    result.mode === 'ZIP'
      ? '压缩包已通过解压炸弹与路径穿越检查'
      : '单文件已通过 HTML 内容校验',
    `共 ${result.fileCount} 个文件、${formatBytes(result.sizeBytes)}，均在平台上限内`,
    `入口文件已识别为 ${result.entryFileSuggested}`,
  ];

  return (
    <div className="check">
      <h3 className="check__title">
        <span className="check__icon" aria-hidden="true">
          <svg viewBox="0 0 20 20" width="18" height="18">
            <path
              d="M10 2 3 5v5c0 4 3 6.5 7 8 4-1.5 7-4 7-8V5l-7-3Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
            <path
              d="m7 10 2 2 4-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        安全检查已通过
      </h3>

      <ul className="check__list">
        {checks.map((text) => (
          <li key={text} className="checkline checkline--ok">
            <span className="checkline__mark" aria-hidden="true">
              <svg viewBox="0 0 16 16" width="12" height="12">
                <path
                  d="M3 8.5 6.5 12 13 4.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span>{text}</span>
          </li>
        ))}
      </ul>

      {result.warnings.length > 0 ? (
        <div className="notice notice--warn">
          <strong>需要留意</strong>
          <ul>
            {result.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {result.ignoredFiles.length > 0 ? (
        <details className="ignored">
          <summary>已忽略 {result.ignoredFiles.length} 个文件</summary>
          <ul>
            {result.ignoredFiles.slice(0, 50).map((item) => (
              <li key={`${item.path}-${item.reason}`}>
                <code>{item.path}</code>
                <span>{IGNORE_REASON[item.reason] ?? item.reason}</span>
              </li>
            ))}
            {result.ignoredFiles.length > 50 ? (
              <li>…另有 {result.ignoredFiles.length - 50} 个未列出</li>
            ) : null}
          </ul>
        </details>
      ) : null}

      <div className="check__tree">
        <h4>文件清单</h4>
        <FileTree nodes={result.fileTree} entryFile={result.entryFileSuggested} />
      </div>
    </div>
  );
}
