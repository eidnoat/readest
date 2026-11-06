import type { RefObject } from 'react';
import { useABSSync } from '@/hooks/useABSSync';
import { useOPDSSubscriptions } from '@/hooks/useOPDSSubscriptions';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { useSettingsStore } from '@/store/settingsStore';
import { getActiveFileSyncBackends } from '@/services/sync/cloudSyncProvider';

export function useLibraryRefresh(
  scrollRef: RefObject<HTMLDivElement | null>,
  pullLibrary: (fullRefresh?: boolean, verbose?: boolean) => Promise<void>,
) {
  const { checkOPDSSubscriptions } = useOPDSSubscriptions();
  const { checkABSServers } = useABSSync();

  const refresh = async (fullRefresh: boolean) => {
    const { settings } = useSettingsStore.getState();
    const hasExternalSources =
      getActiveFileSyncBackends(settings).length > 0 ||
      settings.opdsCatalogs?.some((c) => !c.disabled && !c.deletedAt) ||
      settings.absServers?.some((s) => !s.disabled && !s.deletedAt) ||
      settings.kosync?.enabled ||
      settings.bookorbit?.enabled;
    if (!hasExternalSources) {
      return;
    }
    await pullLibrary(fullRefresh, true);
    await checkOPDSSubscriptions(true);
    await checkABSServers();
  };

  usePullToRefresh(
    scrollRef,
    () => refresh(false),
    () => refresh(true),
  );
}
