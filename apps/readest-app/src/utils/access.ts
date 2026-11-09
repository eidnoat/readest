import { jwtDecode } from 'jwt-decode';
import { UserPlan } from '@/types/quota';
import {
  DEFAULT_DAILY_TRANSLATION_QUOTA,
  DEFAULT_DAILY_TTS_QUOTA,
  DEFAULT_STORAGE_QUOTA,
} from '@/services/constants';
import { getDailyUsage } from '@/services/translators/dailyUsage';
import { getRuntimeConfig } from '@/services/runtimeConfig';

interface Token {
  plan: UserPlan;
  storage_usage_bytes: number;
  storage_purchased_bytes: number;
  customization_purchased: boolean;
  [key: string]: string | number | boolean;
}

export const getSubscriptionPlan = (_token?: string): UserPlan => {
  return 'pro';
};

export const getUserProfilePlan = (_token?: string): UserPlan => {
  return 'pro';
};

export const EMAIL_IN_PLANS: readonly UserPlan[] = ['free', 'plus', 'pro', 'purchase'];

export const isEmailInPlan = (_plan?: UserPlan, _customizationPurchased?: boolean): boolean => true;

export const CLOUD_SYNC_PLANS: readonly UserPlan[] = ['free', 'plus', 'pro', 'purchase'];

export const isCloudSyncInPlan = (_plan?: UserPlan, _customizationPurchased?: boolean): boolean =>
  true;

export const CLOUD_SYNC_REQUIRES_PREMIUM = false;

export const isCloudSyncAllowed = (_plan?: UserPlan, _customizationPurchased?: boolean): boolean =>
  true;

export const TTS_CACHE_PLANS: readonly UserPlan[] = ['free', 'plus', 'pro', 'purchase'];

export const isTTSCacheInPlan = (_plan?: UserPlan, _customizationPurchased?: boolean): boolean =>
  true;

export const TTS_CACHE_REQUIRES_PREMIUM = false;

export const isTTSCacheAllowed = (_plan?: UserPlan, _customizationPurchased?: boolean): boolean =>
  true;

export const isAbsOfflineInPlan = (_plan?: UserPlan, _customizationPurchased?: boolean): boolean =>
  true;

export const ABS_OFFLINE_REQUIRES_PREMIUM = false;

export const isAbsOfflineAllowed = (_plan?: UserPlan, _customizationPurchased?: boolean): boolean =>
  true;

export const ANKI_REQUIRES_PREMIUM = false;

export const isAnkiAllowed = (_plan?: UserPlan, _customizationPurchased?: boolean): boolean => true;

export const NEARBY_PAIRING_PLANS: readonly UserPlan[] = ['free', 'plus', 'pro', 'purchase'];

export const isNearbyPairingInPlan = (
  _plan?: UserPlan,
  _customizationPurchased?: boolean,
): boolean => true;

export const NEARBY_PAIRING_REQUIRES_PREMIUM = false;

export const isNearbyPairingAllowed = (
  _plan?: UserPlan,
  _customizationPurchased?: boolean,
): boolean => true;

export const getCustomizationPurchased = (_token?: string): boolean => true;

export const PREMIUM_PLANS: readonly UserPlan[] = ['free', 'plus', 'pro', 'purchase'];

export const isSelfHosted = (): boolean => true;

export const isCustomizationAllowed = (
  _plan?: UserPlan,
  _customizationPurchased?: boolean,
): boolean => true;

export const isCustomTranslatorAllowed = (_token?: string | null | undefined): boolean => true;

export const isCustomTTSAllowed = (_token?: string | null | undefined): boolean => true;

export const STORAGE_QUOTA_GRACE_BYTES = 10 * 1024 * 1024; // 10 MB grace

export const getStoragePlanData = (token: string) => {
  const data = jwtDecode<Token>(token) || {};
  const plan = data['plan'] || 'free';
  const usage = data['storage_usage_bytes'] || 0;
  const purchasedQuota = data['storage_purchased_bytes'] || 0;
  const runtimeConfig = getRuntimeConfig();
  const fixedQuota =
    runtimeConfig?.storageFixedQuota ?? parseInt(process.env['STORAGE_FIXED_QUOTA'] ?? '0');
  const planQuota = fixedQuota || DEFAULT_STORAGE_QUOTA[plan] || DEFAULT_STORAGE_QUOTA['free'];
  const quota = planQuota + purchasedQuota;

  return {
    plan,
    usage,
    quota,
  };
};

export const getTranslationQuota = (plan: UserPlan): number => {
  const runtimeConfig = getRuntimeConfig();
  const fixedQuota =
    runtimeConfig?.translationFixedQuota ?? parseInt(process.env['TRANSLATION_FIXED_QUOTA'] ?? '0');
  return (
    fixedQuota || DEFAULT_DAILY_TRANSLATION_QUOTA[plan] || DEFAULT_DAILY_TRANSLATION_QUOTA['free']
  );
};

/**
 * Plans that include the self-hosted premium TTS engine ("Readest Voice"):
 * Plus and Pro subscriptions only. Unlike EMAIL_IN_PLANS / CLOUD_SYNC_PLANS
 * this deliberately excludes `purchase` (lifetime): synthesis has a recurring
 * per-character GPU cost that a one-time purchase does not fund.
 */
export const TTS_PLANS: readonly UserPlan[] = ['free', 'plus', 'pro', 'purchase'];

export const isTTSInPlan = (_plan?: UserPlan): boolean => true;

/** A Readest Voice tier: Plus unlocks its voices, Pro unlocks both tiers. */
export const isVoiceTierInPlan = (_tier: 'plus' | 'pro', _plan?: UserPlan): boolean => true;

export const getTTSQuota = (plan: UserPlan): number => {
  const fixedQuota = parseInt(process.env['TTS_FIXED_QUOTA'] ?? '0');
  return fixedQuota || DEFAULT_DAILY_TTS_QUOTA[plan] || 0;
};

export const getTranslationPlanData = (token: string) => {
  const data = jwtDecode<Token>(token) || {};
  const plan: UserPlan = data['plan'] || 'free';
  const usage = getDailyUsage() || 0;
  const quota = getTranslationQuota(plan);

  return {
    plan,
    usage,
    quota,
  };
};

export const getDailyTranslationPlanData = (token: string) => {
  const data = jwtDecode<Token>(token) || {};
  const plan = data['plan'] || 'free';
  const quota = getTranslationQuota(plan);

  return {
    plan,
    quota,
  };
};

export const getAccessToken = async (): Promise<string | null> => {
  return null;
};

export const getUserID = async (): Promise<string | null> => {
  return null;
};

export const validateUserAndToken = async (
  _authHeader: string | null | undefined,
): Promise<{ user?: { id: string; email?: string }; token?: string }> => {
  return { user: { id: 'local-user', email: 'local@readest.app' }, token: 'local-token' };
};
