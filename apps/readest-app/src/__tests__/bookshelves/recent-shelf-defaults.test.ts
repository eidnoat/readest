import { describe, expect, it } from 'vitest';
import { defaultBookshelves, RECENT_BOOKSHELF_ID } from '@/services/bookshelves/definitions';
import { resolveBookshelfGroupBy } from '@/services/bookshelves/grouping';
import { LibraryGroupByType } from '@/types/settings';

describe('Recently read shelf defaults', () => {
  it('lists books ungrouped regardless of the global grouping', () => {
    const recent = defaultBookshelves({ libraryGroupBy: LibraryGroupByType.Group }).find(
      (shelf) => shelf.id === RECENT_BOOKSHELF_ID,
    )!;
    expect(recent.useGlobalGrouping).toBe(false);
    expect(recent.groupBy).toBe('none');
    expect(resolveBookshelfGroupBy(recent, LibraryGroupByType.Group)).toBe('none');
  });

  it('defaults to 20 retained books and respects custom libraryRecentShelfLimit', () => {
    const recentDefault = defaultBookshelves({}).find((shelf) => shelf.id === RECENT_BOOKSHELF_ID)!;
    expect(recentDefault.limit).toBe(20);

    const recentCustom = defaultBookshelves({ libraryRecentShelfLimit: 15 }).find(
      (shelf) => shelf.id === RECENT_BOOKSHELF_ID,
    )!;
    expect(recentCustom.limit).toBe(15);
  });
});
