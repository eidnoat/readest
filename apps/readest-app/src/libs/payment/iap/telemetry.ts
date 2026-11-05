// Telemetry removed.
export type IapWebhookOutcome = 'handled' | 'skipped' | 'rejected' | 'error';

export interface IapWebhookEvent {
  provider: 'apple' | 'google';
  outcome: IapWebhookOutcome;
  notificationType?: string | number;
  status?: string;
  reason?: string;
  durationMs: number;
}

export function recordIapWebhook(_event: IapWebhookEvent): void {
  // No-op
}
