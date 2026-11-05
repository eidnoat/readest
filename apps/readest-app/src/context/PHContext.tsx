'use client';

import { ReactNode } from 'react';

export const initPostHog = () => {
  // Telemetry removed
};

export const CSPostHogProvider = ({ children }: { children: ReactNode }) => {
  return <>{children}</>;
};
