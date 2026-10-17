/**
 * Outbound SMS (Phase 12C, D-125) — the seam a real provider integration plugs into.
 *
 * No provider is integrated in this version (`SMS_PROVIDER=none`, validated at start-up), so
 * nothing in the application sends SMS and no phone-OTP flow is offered. A future integration
 * implements `SmsSender` with server-side credentials only, reports `available: true`, and is the
 * ONLY place that may claim a message was sent. Never log message bodies (they may hold codes).
 */
export interface SmsSender {
  /** True only when a real provider is configured and reachable. */
  readonly available: boolean;
  /** Sends one message or throws; never pretends to have sent it. */
  send(toE164: string, text: string): Promise<void>;
}

export class SmsUnavailableError extends Error {
  constructor() {
    super('SMS delivery is not configured for this school.');
    this.name = 'SmsUnavailableError';
  }
}

/** The only sender in this version: refuses every message. */
export const unavailableSmsSender: SmsSender = {
  available: false,
  send: async () => {
    throw new SmsUnavailableError();
  },
};
