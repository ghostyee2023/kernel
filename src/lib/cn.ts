/**
 * 类名拼接工具。
 *
 * 项目全站使用 globals.css 中的语义类（.btn / .card / .badge ...），
 * Tailwind 原子类仅用于少量布局微调，因此这里只需要最轻量的拼接能力，
 * 不引入 tailwind-merge 之类的重型依赖。
 */
export type ClassValue =
  | string
  | number
  | null
  | undefined
  | false
  | ClassValue[]
  | { [key: string]: boolean | null | undefined };

/**
 * 将任意数量的类名片段合并为一个字符串，自动忽略假值并去重。
 *
 * @param inputs 类名片段，支持字符串、数组与 `{ 类名: 是否启用 }` 对象。
 * @returns 合并去重后的类名字符串。
 */
export function cn(...inputs: ClassValue[]): string {
  const out: string[] = [];

  const walk = (value: ClassValue): void => {
    if (!value && value !== 0) return;

    if (typeof value === 'string' || typeof value === 'number') {
      out.push(String(value));
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }

    if (typeof value === 'object') {
      for (const [key, enabled] of Object.entries(value)) {
        if (enabled) out.push(key);
      }
    }
  };

  for (const input of inputs) walk(input);

  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const token of out.join(' ').split(/\s+/)) {
    if (!token || seen.has(token)) continue;
    seen.add(token);
    deduped.push(token);
  }
  return deduped.join(' ');
}
