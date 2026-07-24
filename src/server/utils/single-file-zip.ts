import fs from 'node:fs';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInflateRaw } from 'node:zlib';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const MAX_EOCD_SIZE = 22 + 0xffff;
const MAX_WINDOWS_INSTALLER_SIZE = 2 * 1024 * 1024 * 1024;

export interface SingleZipEntry {
  fileName: string;
  compressionMethod: 0 | 8;
  compressedSize: number;
  uncompressedSize: number;
  dataOffset: number;
}

export async function inspectSingleFileZip(zipPath: string, expectedFileName: string): Promise<SingleZipEntry> {
  const handle = await fs.promises.open(zipPath, 'r');
  try {
    const stat = await handle.stat();
    if (stat.size < 22) throw new Error('The Windows installer ZIP is invalid.');
    const tailSize = Math.min(stat.size, MAX_EOCD_SIZE);
    const tail = await readExactly(handle, tailSize, stat.size - tailSize);
    const eocdOffset = findEocd(tail);
    if (eocdOffset < 0) throw new Error('The Windows installer ZIP has no valid directory.');

    const diskNumber = tail.readUInt16LE(eocdOffset + 4);
    const centralDisk = tail.readUInt16LE(eocdOffset + 6);
    const entriesOnDisk = tail.readUInt16LE(eocdOffset + 8);
    const totalEntries = tail.readUInt16LE(eocdOffset + 10);
    const centralSize = tail.readUInt32LE(eocdOffset + 12);
    const centralOffset = tail.readUInt32LE(eocdOffset + 16);
    if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== 1 || totalEntries !== 1) {
      throw new Error('The ZIP must contain exactly one Windows installer.');
    }
    if (centralOffset + centralSize > stat.size) throw new Error('The Windows installer ZIP directory is invalid.');

    const central = await readExactly(handle, 46, centralOffset);
    if (central.readUInt32LE(0) !== CENTRAL_SIGNATURE) throw new Error('The Windows installer ZIP directory is invalid.');
    const flags = central.readUInt16LE(8);
    const method = central.readUInt16LE(10);
    const compressedSize = central.readUInt32LE(20);
    const uncompressedSize = central.readUInt32LE(24);
    const fileNameLength = central.readUInt16LE(28);
    const extraLength = central.readUInt16LE(30);
    const commentLength = central.readUInt16LE(32);
    const localOffset = central.readUInt32LE(42);
    if ((flags & 1) !== 0) throw new Error('Encrypted ZIP archives are not supported.');
    if (method !== 0 && method !== 8) throw new Error('The ZIP uses an unsupported compression method.');
    if ([compressedSize, uncompressedSize, localOffset].includes(0xffffffff)) {
      throw new Error('ZIP64 archives are not supported for Windows installers.');
    }
    if (uncompressedSize === 0) throw new Error('The Windows installer cannot be empty.');
    if (uncompressedSize > MAX_WINDOWS_INSTALLER_SIZE) throw new Error('The Windows installer ZIP is too large.');
    if (46 + fileNameLength + extraLength + commentLength > centralSize) {
      throw new Error('The Windows installer ZIP entry is invalid.');
    }
    const centralName = (await readExactly(handle, fileNameLength, centralOffset + 46)).toString('utf8');
    if (centralName !== expectedFileName || path.basename(centralName) !== centralName) {
      throw new Error(`The ZIP must contain only ${expectedFileName}.`);
    }

    const local = await readExactly(handle, 30, localOffset);
    if (local.readUInt32LE(0) !== LOCAL_SIGNATURE) throw new Error('The Windows installer ZIP entry is invalid.');
    if (local.readUInt16LE(8) !== method) throw new Error('The Windows installer ZIP headers do not match.');
    const localNameLength = local.readUInt16LE(26);
    const localExtraLength = local.readUInt16LE(28);
    const localName = (await readExactly(handle, localNameLength, localOffset + 30)).toString('utf8');
    if (localName !== expectedFileName) throw new Error('The Windows installer ZIP headers do not match.');
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (dataOffset + compressedSize > centralOffset) throw new Error('The Windows installer ZIP data is truncated.');

    return {
      fileName: centralName,
      compressionMethod: method,
      compressedSize,
      uncompressedSize,
      dataOffset,
    };
  } finally {
    await handle.close();
  }
}

export async function extractSingleFileZip(
  zipPath: string,
  destination: string,
  expectedFileName: string,
): Promise<SingleZipEntry> {
  const entry = await inspectSingleFileZip(zipPath, expectedFileName);
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  let written = 0;
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      written += chunk.length;
      if (written > entry.uncompressedSize) {
        callback(new Error('The Windows installer ZIP expands beyond its declared size.'));
        return;
      }
      callback(null, chunk);
    },
  });
  const source = fs.createReadStream(zipPath, {
    start: entry.dataOffset,
    end: entry.dataOffset + entry.compressedSize - 1,
  });
  const target = fs.createWriteStream(destination, { flags: 'wx', mode: 0o600 });
  try {
    if (entry.compressionMethod === 8) await pipeline(source, createInflateRaw(), meter, target);
    else await pipeline(source, meter, target);
    if (written !== entry.uncompressedSize) throw new Error('The extracted Windows installer has an invalid size.');
    return entry;
  } catch (error) {
    await fs.promises.rm(destination, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function readExactly(handle: fs.promises.FileHandle, length: number, position: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  if (bytesRead !== length) throw new Error('The Windows installer ZIP is truncated.');
  return buffer;
}

function findEocd(buffer: Buffer): number {
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) !== EOCD_SIGNATURE) continue;
    const commentLength = buffer.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength === buffer.length) return offset;
  }
  return -1;
}
