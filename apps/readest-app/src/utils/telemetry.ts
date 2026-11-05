export const TELEMETRY_OPT_OUT_KEY = 'readest-telemetry-opt-out';
export const TELEMETRY_DECISION_KEY = 'readest-telemetry-decision';

export type TelemetryDecision = 'opt-in' | 'opt-out' | 'pending';

export const TELEMETRY_PROMPT_BUCKET_RATE = 0;

export const hasOptedOutTelemetry = () => true;

export const getTelemetryDecision = (): TelemetryDecision => 'opt-out';

export const setTelemetryDecision = (_decision: TelemetryDecision) => {};

export const rollIntoTelemetryPromptBucket = (_rng?: () => number) => false;

export const captureEvent = (_event: string, _properties?: Record<string, unknown>) => {};

export const optInTelemetry = () => {};

export const optOutTelemetry = () => {};

export const applyPostHogConsent = () => {};

export const reconcileTelemetryConsent = (_telemetryEnabled: boolean) => false;
