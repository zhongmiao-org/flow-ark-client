export const EMBEDDED_CLOSE_TIMEOUT_MS = 5000;
export const EMBEDDED_CLOSE_RPC_TIMEOUT_MS = 8000;
export const EMBEDDED_FLUSH_TIMEOUT_MS = 1000;

export type CleanupResult = {
  confirmed: boolean;
  error?: string;
  warnings?: string[];
};

export type EmbeddedStartReceipt = {
  token: string;
  resourceId: string;
  state: 'ready';
};

export type EmbeddedCloseReceipt =
  | {
      state: 'closed';
      // Identity is absent only when Main closes an unleased preview or an empty panel.
      token?: string;
      resourceId?: string;
      warnings?: string[];
    }
  | {
      state: 'unknown';
      token?: string;
      resourceId?: string;
      error: string;
    };

export type EmbeddedLostNotice = {
  token?: string;
  resourceId: string;
  reason: string;
  destroyed: boolean;
};

export type EmbeddedCleanupFailure = {
  token?: string;
  resourceId?: string;
  error: string;
};
