import { AvailablePlan, PlanType } from '@/types/quota';
import { StripeProductMetadata } from '@/types/payment';

export interface StripeCheckoutResponse {
  sessionId?: string;
  clientSecret?: string;
  url?: string;
}

export type StripeAvailablePlan = AvailablePlan & {
  metadata?: StripeProductMetadata;
};

export type StripePortalFlow = 'subscription_cancel' | 'subscription_update';

export const getStripe = async () => null;

export const fetchStripePlans = async (): Promise<StripeAvailablePlan[]> => [];

export const createStripeCheckoutSession = async (
  _productId: string,
  _planType: PlanType = 'subscription',
): Promise<StripeCheckoutResponse> => {
  throw new Error('Payments are disabled');
};

export const redirectToStripeCheckout = async (_url?: string): Promise<void> => {};

export const createStripePortalSession = async (_flow?: StripePortalFlow): Promise<string> => {
  throw new Error('Payments are disabled');
};

export const redirectToStripePortal = async (_url?: string): Promise<void> => {};

export const handleStripeCheckoutError = (_errorMessage: string): void => {};

export const getSubscriptionSuccessUrl = (_sessionId: string): string => '/user';
