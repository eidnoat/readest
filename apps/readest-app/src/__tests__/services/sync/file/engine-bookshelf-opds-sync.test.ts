import { describe, expect, it, vi } from 'vitest';
import type { BookshelfState } from '@/types/bookshelf';
import type { OPDSCatalog } from '@/types/opds';
import { FileSyncEngine, mergeOPDSCatalogs } from '@/services/sync/file/engine';
import { applyBookshelfDraft } from '@/services/bookshelves/state';
import { defaultBookshelves } from '@/services/bookshelves/definitions';
import type { LocalStore } from '@/services/sync/file/localStore';
import type { FileSyncProvider } from '@/services/sync/file/provider';
import type { RemoteLibraryIndex } from '@/services/sync/file/wire';

describe('mergeOPDSCatalogs', () => {
  it('merges catalogs using Last-Writer-Wins on timestamp', () => {
    const local: OPDSCatalog[] = [
      {
        id: 'cat-1',
        name: 'Local Catalog',
        url: 'https://opds.example.com/1',
        contentId: 'cid-1',
        updatedAt: 100,
        username: 'user1',
        password: 'pass1',
      },
    ];

    const remote: OPDSCatalog[] = [
      {
        id: 'cat-1-remote',
        name: 'Remote Catalog (Updated)',
        url: 'https://opds.example.com/1',
        contentId: 'cid-1',
        updatedAt: 200,
      },
      {
        id: 'cat-2',
        name: 'New Remote Catalog',
        url: 'https://opds.example.com/2',
        contentId: 'cid-2',
        updatedAt: 150,
      },
    ];

    const merged = mergeOPDSCatalogs(local, remote);
    expect(merged).toHaveLength(2);

    const cat1 = merged.find((c) => c.contentId === 'cid-1');
    expect(cat1?.name).toBe('Remote Catalog (Updated)');
    // Preserves local credentials when remote omitted them
    expect(cat1?.username).toBe('user1');
    expect(cat1?.password).toBe('pass1');

    const cat2 = merged.find((c) => c.contentId === 'cid-2');
    expect(cat2?.name).toBe('New Remote Catalog');
  });

  it('keeps local catalog when local timestamp is newer', () => {
    const local: OPDSCatalog[] = [
      {
        id: 'cat-1',
        name: 'Local Catalog (Newer)',
        url: 'https://opds.example.com/1',
        contentId: 'cid-1',
        updatedAt: 300,
      },
    ];

    const remote: OPDSCatalog[] = [
      {
        id: 'cat-1',
        name: 'Remote Catalog (Older)',
        url: 'https://opds.example.com/1',
        contentId: 'cid-1',
        updatedAt: 200,
        username: 'remoteUser',
      },
    ];

    const merged = mergeOPDSCatalogs(local, remote);
    expect(merged[0]?.name).toBe('Local Catalog (Newer)');
    // Preserves credentials from remote
    expect(merged[0]?.username).toBe('remoteUser');
  });
});

describe('FileSyncEngine — Bookshelves & OPDS Sync', () => {
  const makeFakeProvider = (initialIndex: RemoteLibraryIndex | null = null): FileSyncProvider => {
    let indexRaw = initialIndex ? JSON.stringify(initialIndex) : null;
    return {
      rootPath: 'Readest',
      readText: vi.fn(async () => indexRaw),
      writeText: vi.fn(async (_path: string, content: string) => {
        indexRaw = content;
      }),
      head: vi.fn(async () => (indexRaw ? { etag: 'etag-1', size: indexRaw.length } : null)),
      exists: vi.fn(async () => !!indexRaw),
      list: vi.fn(async () => []),
      delete: vi.fn(async () => {}),
      ensureDir: vi.fn(async () => {}),
      deleteDir: vi.fn(async () => {}),
      readBinary: vi.fn(async () => new ArrayBuffer(0)),
      writeBinary: vi.fn(async () => {}),
    } as unknown as FileSyncProvider;
  };

  it('pulls and merges bookshelves and OPDS catalogs from remote index', async () => {
    const base = defaultBookshelves({});
    const remoteBookshelves = applyBookshelfDraft(
      { rows: {} },
      base,
      base.map((s) => (s.id === 'default' ? { ...s, name: 'Remote Main' } : s)),
      {
        userId: 'u1',
        deviceId: 'd1',
        next: () => '0000000000100-00000000-d1' as never,
      },
    ).state;

    const remoteIndex: RemoteLibraryIndex = {
      schemaVersion: 1,
      books: [],
      updatedAt: 1000,
      bookshelves: remoteBookshelves,
      opdsCatalogs: [
        {
          id: 'cat-remote',
          name: 'Remote OPDS',
          url: 'https://opds.example.com',
          contentId: 'cid-remote',
          updatedAt: 500,
        },
      ],
    };

    let localBookshelves: BookshelfState | null = { rows: {} };
    let localCatalogs: OPDSCatalog[] = [];

    const store: Partial<LocalStore> = {
      loadConfig: vi.fn(async () => null),
      saveBookConfig: vi.fn(async () => {}),
      loadBookFile: vi.fn(async () => null),
      resolveLocalBookPath: vi.fn(async () => null),
      saveBookFile: vi.fn(async () => {}),
      prepareLocalBookPath: vi.fn(async () => ''),
      loadBookCover: vi.fn(async () => null),
      saveBookCover: vi.fn(async () => {}),
      addBookToLibrary: vi.fn(async () => {}),
      updateBookMetadata: vi.fn(async () => {}),
      markBooksUploaded: vi.fn(async () => {}),
      deleteBookLocally: vi.fn(async () => {}),
      loadBookshelves: vi.fn(async () => localBookshelves),
      saveBookshelves: vi.fn(async (state) => {
        localBookshelves = state;
      }),
      loadOPDSCatalogs: vi.fn(async () => localCatalogs),
      saveOPDSCatalogs: vi.fn(async (catalogs) => {
        localCatalogs = catalogs;
      }),
    };

    const provider = makeFakeProvider(remoteIndex);
    const engine = new FileSyncEngine(provider, store as LocalStore);

    await engine.syncLibrary([], { deviceId: 'test-device', syncBooks: false });
    expect(localBookshelves?.rows['default']).toBeDefined();
    expect(localCatalogs).toHaveLength(1);
    expect(localCatalogs[0]?.name).toBe('Remote OPDS');
  });

  it('pushes local bookshelves and OPDS catalogs into remote library index', async () => {
    const base = defaultBookshelves({});
    const localBookshelves = applyBookshelfDraft(
      { rows: {} },
      base,
      base.map((s) => (s.id === 'default' ? { ...s, name: 'Local Main' } : s)),
      {
        userId: 'u1',
        deviceId: 'd1',
        next: () => '0000000000200-00000000-d1' as never,
      },
    ).state;

    const localCatalogs: OPDSCatalog[] = [
      {
        id: 'cat-local',
        name: 'My Local OPDS',
        url: 'https://local-opds.example.com',
        contentId: 'cid-local',
        updatedAt: 600,
      },
    ];

    const store: Partial<LocalStore> = {
      loadConfig: vi.fn(async () => null),
      saveBookConfig: vi.fn(async () => {}),
      loadBookFile: vi.fn(async () => null),
      resolveLocalBookPath: vi.fn(async () => null),
      saveBookFile: vi.fn(async () => {}),
      prepareLocalBookPath: vi.fn(async () => ''),
      loadBookCover: vi.fn(async () => null),
      saveBookCover: vi.fn(async () => {}),
      addBookToLibrary: vi.fn(async () => {}),
      updateBookMetadata: vi.fn(async () => {}),
      markBooksUploaded: vi.fn(async () => {}),
      deleteBookLocally: vi.fn(async () => {}),
      loadBookshelves: vi.fn(async () => localBookshelves),
      saveBookshelves: vi.fn(async () => {}),
      loadOPDSCatalogs: vi.fn(async () => localCatalogs),
      saveOPDSCatalogs: vi.fn(async () => {}),
    };

    const provider = makeFakeProvider(null);
    const engine = new FileSyncEngine(provider, store as LocalStore);

    await engine.syncLibrary([], { deviceId: 'test-device', syncBooks: false });
    const pushedIndex = await engine.pullLibraryIndex();
    expect(pushedIndex?.bookshelves?.rows['default']).toBeDefined();
    expect(pushedIndex?.opdsCatalogs).toHaveLength(1);
    expect(pushedIndex?.opdsCatalogs?.[0]?.name).toBe('My Local OPDS');
  });
});
