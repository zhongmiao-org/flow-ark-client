import type { FlowArkP1 as P1Contracts } from './contracts.generated';
export type Flow = NonNullable<P1Contracts['FlowDefinition']>;
export type Step = Flow['steps'][number];
export type Policy = NonNullable<P1Contracts['RecruitingPolicy']>;
export type Draft = NonNullable<P1Contracts['AIReplyDraft']>;
export type AIRequest = NonNullable<P1Contracts['AIReplyRequest']>;
export type AIResult = NonNullable<P1Contracts['AIReplyResult']>;
export type Action = NonNullable<P1Contracts['RecruitingAction']>;
export type Contact = NonNullable<P1Contracts['ContactExchangeResult']>;
export type Template = NonNullable<P1Contracts['TemplatePackage']>;
export type RunState = NonNullable<P1Contracts['RunState']>;
export type ScriptBundle = NonNullable<P1Contracts['ScriptBundle']>;
export type PreparedScripts = { scripts: Record<string, string>; scriptBundles: ScriptBundle[] };
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Bindings = {
  browserId?: string;
  files: Record<string, string>;
  credentials: string[];
  scriptPackages?: Record<string, { path: string; version: string }>;
  policy?: Policy;
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
  scheduleId?: string;
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
  product: 'chrome' | 'firefox' | 'safari';
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
export type Bootstrap = {
  flows: FlowRecord[];
  runs: Run[];
  browsers: BrowserBinding[];
  schedules: Schedule[];
  attention: Attention[];
  templates: Template[];
  credentials: string[];
  fault?: string;
  dataPath: string;
};
export type Bridge = { request(method: string, args?: any): Promise<any> };
export type BrowserCommand = {
  operation: string;
  selector?: string;
  value?: any;
  timeoutMs?: number;
};
export type BrowserDriver = {
  perform(command: BrowserCommand): Promise<any>;
  close(): Promise<void>;
};
