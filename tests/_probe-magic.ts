/** 临时探针：确认 fileTypeFromBuffer 在短/截断输入下的抛错行为。 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { assertRealType, detectMagic } from '../src/lib/upload/validate';
import { dataRoot } from '../src/lib/storage';

const dir = path.join(dataRoot(), 'tmp', 'qa-probe');

const samples: Array<[string, Buffer, 'ZIP' | 'SINGLE_FILE']> = [
  ['png-truncated-11B.html', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]), 'SINGLE_FILE'],
  ['png-truncated-11B.zip', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]), 'ZIP'],
  ['empty.zip', Buffer.alloc(0), 'ZIP'],
  ['tiny-2B.zip', Buffer.from('PK'), 'ZIP'],
  ['truncated-zip-hdr.zip', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]), 'ZIP'],
  ['plain-text.zip', Buffer.from('hello world, definitely not a zip'), 'ZIP'],
  ['short-html.html', Buffer.from('<h1>hi</h1>'), 'SINGLE_FILE'],
];

async function main(): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  for (const [name, buf, mode] of samples) {
    const file = path.join(dir, name);
    await fs.writeFile(file, buf);

    let magicOutcome: string;
    try {
      magicOutcome = `returned ${JSON.stringify(await detectMagic(file))}`;
    } catch (e) {
      magicOutcome = `THREW ${(e as Error).name}: ${(e as Error).message}`;
    }

    let assertOutcome: string;
    try {
      await assertRealType(file, name, mode);
      assertOutcome = 'PASSED (no throw)';
    } catch (e) {
      const err = e as { name?: string; code?: string; message?: string };
      assertOutcome = err.code
        ? `AppError ${err.code}`
        : `!! RAW ${err.name}: ${err.message} -> maps to HTTP 500 INTERNAL_ERROR`;
    }

    console.log(`${name.padEnd(26)} mode=${mode.padEnd(12)} detectMagic=${magicOutcome.padEnd(46)} assertRealType=${assertOutcome}`);
  }
  await fs.rm(dir, { recursive: true, force: true });
}

void main();
