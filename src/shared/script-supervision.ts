import type { CleanupResult } from './embedded-lifecycle';

export const SCRIPT_READY_TIMEOUT_MS = 3000;
export const SCRIPT_CLEANUP_TIMEOUT_MS = 5000;
export const SCRIPT_RECOVERY_TIMEOUT_MS = 5000;
export const SCRIPT_COOPERATIVE_STOP_MS = 200;
export const SCRIPT_EXECUTE_RPC_TIMEOUT_MS = 24 * 3600000;
export const SCRIPT_LEASE_KIND = 'script-lease';

export type ScriptOwner = {
  runId: string;
  invocationId: string;
  nodeId: string;
  nodeInstance: string;
};
export type ScriptExecution = ScriptOwner & {
  compiled: string;
  sha256: string;
  input: unknown;
};
export type ScriptCall = 'log' | 'progress' | 'artifact' | 'credential' | 'template';
export type ScriptCleanupResult = CleanupResult;
export type ScriptLease = ScriptOwner & {
  recordVersion: 1;
  nonce: string;
  bootId: string;
  createdAt: string;
  phase: 'allocating' | 'registered' | 'executing' | 'closing' | 'unknown';
  pid?: number;
  pgid?: number;
  error?: string;
};

export class ScriptProcessInterruptedError extends Error {
  readonly code = 'SCRIPT_PROCESS_INTERRUPTED';
  constructor(message: string) {
    super(message);
    this.name = 'ScriptProcessInterruptedError';
  }
}

// This private protocol is tied to one application bundle, not Renderer IPC.
export type ScriptSupervisorMessage =
  | { kind: 'script-init'; nonce: string }
  | { kind: 'script-stop'; nonce: string; cooperative?: boolean }
  | { kind: 'script-ready'; nonce: string; pid: number; pgid: number }
  | { kind: 'script-fault'; nonce: string; error: string }
  | { kind: 'script-rpc'; nonce: string; message: unknown };
