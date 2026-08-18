/**
 * 极简 ZIP 写入器（测试专用）。
 *
 * 为什么不引第三方打包库：
 *   被测代码（lib/upload/zip.ts）的安全判定完全依赖 **中央目录里声明的字段**
 *   （uncompressedSize / externalFileAttributes / fileName）。只有自己拼字节，
 *   才能精确构造「声明与实际不一致」「符号链接」「路径穿越」这类恶意样本。
 *
 * 支持：store / deflate、伪造 uncompressedSize、自定义 unix mode（符号链接）。
 * 不支持 ZIP64（测试样本条目数与体积均在 32 位范围内）。
 */

import { crc32, deflateRawSync } from 'node:zlib';

/** 单个 ZIP 条目的构造参数。 */
export interface ZipEntrySpec {
  /** 条目名（POSIX 或恶意路径均可原样写入）。以 `/` 结尾视为目录。 */
  name: string;
  /** 条目内容。目录条目可省略。 */
  data?: Buffer | string;
  /** 强制 store（不压缩），默认对非空文件用 deflate。 */
  store?: boolean;
  /** 外部属性高 16 位的 unix mode。符号链接传 `0o120777`。 */
  unixMode?: number;
  /** 覆写中央目录中声明的 uncompressedSize（构造「撒谎的 ZIP」）。 */
  fakeUncompressedSize?: number;
}

const LOCAL_HEADER_SIG = 0x04034b50;
const CENTRAL_HEADER_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

/** DOS 日期 1980-01-01（时间 0）。 */
const DOS_TIME = 0;
const DOS_DATE = 0x21;

/** UTF-8 文件名标志位。 */
const FLAG_UTF8 = 0x0800;

/** version made by：高字节 3 = UNIX，低字节 20 = ZIP 2.0。 */
const VERSION_MADE_BY = (3 << 8) | 20;

/**
 * 把条目列表拼成完整的 ZIP 字节流。
 *
 * @param entries 条目列表。
 * @returns 可直接落盘的 ZIP Buffer。
 */
export function buildZip(entries: ZipEntrySpec[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const spec of entries) {
    const nameBuf = Buffer.from(spec.name, 'utf8');
    const raw =
      spec.data === undefined
        ? Buffer.alloc(0)
        : Buffer.isBuffer(spec.data)
          ? spec.data
          : Buffer.from(spec.data, 'utf8');

    const isDir = spec.name.endsWith('/');
    const useDeflate = spec.store !== true && !isDir && raw.length > 0;
    const payload = useDeflate ? deflateRawSync(raw, { level: 9 }) : raw;
    const method = useDeflate ? 8 : 0;
    const crc = raw.length === 0 ? 0 : crc32(raw);
    const declaredSize = spec.fakeUncompressedSize ?? raw.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_HEADER_SIG, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(FLAG_UTF8, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc >>> 0, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(declaredSize, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBuf, payload);

    const unixMode = spec.unixMode ?? (isDir ? 0o040755 : 0o100644);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_HEADER_SIG, 0);
    central.writeUInt16LE(VERSION_MADE_BY, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(FLAG_UTF8, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc >>> 0, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(declaredSize, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(((unixMode & 0xffff) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuf);

    offset += local.length + nameBuf.length + payload.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDir, eocd]);
}

/** 一个最小可用的作品 HTML。 */
export const DEMO_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>QA 测试作品</title><link rel="stylesheet" href="assets/style.css"></head>
<body><h1 id="t">Kernel QA Fixture</h1><script src="assets/app.js"></script></body>
</html>
`;

/** 一个正常的多文件作品 ZIP（index.html + css + js + png）。 */
export function buildNormalZip(): Buffer {
  return buildZip([
    { name: 'index.html', data: DEMO_HTML },
    { name: 'assets/', data: undefined },
    { name: 'assets/style.css', data: 'body{background:#0E1014;color:#fff;font-family:system-ui}' },
    { name: 'assets/app.js', data: 'document.getElementById("t").dataset.ok="1";' },
    // 1x1 透明 PNG
    {
      name: 'assets/dot.png',
      data: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      ),
      store: true,
    },
  ]);
}
