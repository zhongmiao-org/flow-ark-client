import type { FlowArkP1 as P1Contracts } from './contracts.generated';
import type { RunOverview } from './run-history';
import type { RunRerunMode } from './run-rerun';
export type Flow = NonNullable<P1Contracts['FlowDefinition']>;
export type Step = Flow['steps'][number];
export type AIRequest = NonNullable<P1Contracts['AIRequest']>;
export type AIResult = NonNullable<P1Contracts['AIResult']>;
export type RunState = NonNullable<P1Contracts['RunState']>;
export type ScriptBundle = NonNullable<P1Contracts['ScriptBundle']>;
export type PreparedScripts = { scripts: Record<string, string>; scriptBundles: ScriptBundle[] };
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Bindings = {
  browserId?: string;
  files: Record<string, string>;
  credentials: string[];
  scriptPackages?: Record<string, { path: string; version: string }>;
  template?: { instanceId: string; packageKey: string; entryId: string; digest: string };
  resources?: Record<
    string,
    { path?: string; browserId?: string; provider?: 'deepseek' | 'openai-codex'; model?: string }
  >;
  grants?: Record<string, 'deny' | 'confirm' | 'auto'>;
  configuration?: { adapter: string; schema: Json; values: Json };
};
export type FlowRecord = {
  id: string;
  flow: Flow;
  bindings: Bindings;
  updatedAt: string;
  versionId?: string;
};
export type Run = {
  id: string;
  flowId: string;
  versionId: string;
  name: string;
  state: RunState;
  createdAt: string;
  updatedAt: string;
  source: string;
  debug?: boolean;
  scheduleId?: string;
  rerun?: { runId: string; mode: RunRerunMode; reviewedAt: string };
  error?: string;
  business: string;
};
export type Event = {
  runId: string;
  sequence: number;
  time: string;
  type: string;
  nodeInstance: string;
  data: any;
};
export type BrowserBinding = {
  id: string;
  product: 'chrome' | 'firefox' | 'safari' | 'embedded';
  executable: string;
  version: string;
  driver?: string;
  driverVersion?: string;
};
export type Schedule = {
  id: string;
  flowId: string;
  versionId: string;
  intervalMinutes: number;
  timezone: string;
  enabled: boolean;
  nextAt: number;
  revision?: string;
};
export type Attention = {
  id: string;
  kind: string;
  title: string;
  detail: any;
  dedupeKey: string;
  read: boolean;
  time: string;
};
export type ExecutionObservation = {
  observedAt: string;
  // No Active owner does not prove that historical unknown resources exited.
  active: { runId: string; phase: 'executing' | 'closing' } | null;
};
export type Bootstrap = {
  flows: FlowRecord[];
  runs: Run[];
  runOverview: RunOverview;
  browsers: BrowserBinding[];
  schedules: Schedule[];
  attention: Attention[];
  templates: import('../templates/archive').InstalledPackage[];
  instances: import('../templates/types').TemplateInstance[];
  credentials: string[];
  fault?: string;
  execution?: ExecutionObservation;
  runtimeBlock?: string;
  dataPath: string;
};
export type Bridge = { request(method: string, args?: any): Promise<any> };
export type BrowserCommand = {
  operation: string;
  selector?: string;
  framePath?: string[];
  value?: any;
  timeoutMs?: number;
};
export type BrowserDriver = {
  perform(command: BrowserCommand): Promise<any>;
  close(): Promise<void>;
};
