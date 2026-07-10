import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

/**
 * Tiny JSON-file store under userData. Enough for settings, the saved-game
 * library, and the review cache; no reason to pull in a database.
 */
export class JsonStore {
  private path: string;
  private data: Record<string, unknown>;

  constructor(filename: string) {
    const dir = app.getPath('userData');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.path = join(dir, filename);
    this.data = this.load();
  }

  private load(): Record<string, unknown> {
    if (!existsSync(this.path)) return {};
    try {
      return JSON.parse(readFileSync(this.path, 'utf8')) as Record<string, unknown>;
    } catch {
      // Corrupt file shouldn't brick the app; start clean and keep the bad copy.
      try {
        renameSync(this.path, this.path + '.corrupt');
      } catch {
        /* ignore */
      }
      return {};
    }
  }

  private flush(): void {
    // Write-then-rename so a crash mid-write can't truncate the store.
    const tmp = this.path + '.tmp';
    writeFileSync(tmp, JSON.stringify(this.data), 'utf8');
    renameSync(tmp, this.path);
  }

  get<T>(key: string, fallback: T): T {
    return (this.data[key] as T) ?? fallback;
  }

  set(key: string, value: unknown): void {
    this.data[key] = value;
    this.flush();
  }

  delete(key: string): void {
    delete this.data[key];
    this.flush();
  }

  keys(): string[] {
    return Object.keys(this.data);
  }
}
