/**
 * 三步进度指示器。
 *
 * 用 `<ol>` + `aria-current` 而不是纯装饰性 div，读屏用户也能知道走到第几步。
 * 状态走 `data-state`（done / active / todo），与设计系统的 `.step[data-state]` 对齐。
 */

import * as React from 'react';

/** 组件属性。 */
export interface StepsProps {
  /** 当前步骤，1 起。 */
  current: number;
  /** 步骤文案。 */
  labels?: string[];
}

/** 默认步骤文案。 */
const DEFAULT_LABELS = ['上传文件', '完善信息', '发布成功'];

/** 渲染步骤条。 */
export function Steps({ current, labels = DEFAULT_LABELS }: StepsProps) {
  return (
    <ol className="steps" aria-label="发布流程">
      {labels.map((label, index) => {
        const step = index + 1;
        const state = step < current ? 'done' : step === current ? 'active' : 'todo';

        return (
          <React.Fragment key={label}>
            <li
              className="step"
              data-state={state}
              aria-current={state === 'active' ? 'step' : undefined}
            >
              <span className="step__n" aria-hidden="true">
                {state === 'done' ? (
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
                ) : (
                  step
                )}
              </span>
              <span className="step__label">{label}</span>
            </li>

            {step < labels.length ? <li className="step__line" aria-hidden="true" /> : null}
          </React.Fragment>
        );
      })}
    </ol>
  );
}
