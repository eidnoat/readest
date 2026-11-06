import { useEffect } from 'react';
import { QuotaType, UserPlan } from '@/types/quota';
import {
  setCachedCustomizationPurchased,
  setCachedUserPlan,
} from '@/services/sync/cloudSyncProvider';

export const useQuotaStats = (_briefName = false) => {
  useEffect(() => {
    setCachedUserPlan('pro');
    setCachedCustomizationPurchased(true);
  }, []);

  return {
    quotas: [] as QuotaType[],
    userProfilePlan: 'pro' as UserPlan,
    customizationPurchased: true,
  };
};
