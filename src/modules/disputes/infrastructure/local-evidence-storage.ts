import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { EvidenceStorage } from '../domain/ports';

export interface LocalEvidenceStorageOptions {
  baseDir: string;
}

const STORAGE_URL_PREFIX = 'local://evidence/';

export function createLocalEvidenceStorage(options: LocalEvidenceStorageOptions): EvidenceStorage {
  const baseDir = resolve(options.baseDir);

  function resolveStoragePath(storageUrl: string): string {
    if (!storageUrl.startsWith(STORAGE_URL_PREFIX)) {
      throw new Error(`Invalid evidence storage url: ${storageUrl}`);
    }
    const relative = storageUrl.slice(STORAGE_URL_PREFIX.length);
    const absolute = resolve(join(baseDir, relative));
    if (absolute !== baseDir && !absolute.startsWith(`${baseDir}/`)) {
      throw new Error(`Evidence storage url escapes base directory: ${storageUrl}`);
    }
    return absolute;
  }

  return {
    async save(input) {
      const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const relative = join(input.disputeId, `${randomUUID()}-${safeName}`);
      const absolute = resolve(join(baseDir, relative));
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, input.data);
      return { storageUrl: `${STORAGE_URL_PREFIX}${relative}` };
    },

    async read(storageUrl) {
      const absolute = resolveStoragePath(storageUrl);
      return readFile(absolute);
    },

    async delete(storageUrl) {
      const absolute = resolveStoragePath(storageUrl);
      await rm(absolute, { force: true });

      // Remove now-empty dispute directories up to (but not including) the base dir.
      let current = dirname(absolute);
      while (current !== baseDir && current.startsWith(`${baseDir}/`)) {
        try {
          await rm(current, { recursive: false });
        } catch {
          break;
        }
        current = dirname(current);
      }
    },
  };
}
