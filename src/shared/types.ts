import type { TemplateAttentionOrigin } from '../../contracts/template-attention';
import type { FlowArkP1 as P1Contracts } from './contracts.generated';
import type { RunOverview } from './run-history';
import type { RunRerunMode } from './run-rerun';
export type Flow = NonNullable<P1Contracts['FlowDefinition']>;
export type Step = Flow['steps'][number];
export type AIRequest = NonNullable<P1Contracts['AIRequest']>;
export type AIResult = NonNullable<P1Contracts['AIResult']>;
export type AIOutcome = NonNullable<P1Contracts['AIOutcome']>;
export type AIRequestFailure = NonNullable<P1Contracts['AIRequestFailure']>;
export type AINodeReceipt = NonNullable<P1Contracts['AINodeReceipt']>;
export type RunState = NonNullable<P1Contracts['RunState']>;
export type ScriptBundle = NonNullable<P1Contracts['ScriptBundle']>;
export type PreparedScripts = {
  scripts: Record<string, string>;
  scriptBundles: ScriptBundle[];
  skillSnapshots?: Record<string, import('./skill').SkillVersion>;
  templateData?: import('./template-data').DataContext;
  authorSdk?: import('./contracts.generated').TemplateAuthorSdkContext;
  resultSources?: import('./contracts.generated').RunResultPreparedSources;
  resultRetention?: import('./contracts.generated').ResultRetentionPolicy;
  templateResourceExtension?: import('./contracts.generated').TemplateResourceExtensionReceipt;
};
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Bindings = {
  browserId?: string;
  files: Record<string, string>;
  credentials: string[];
  scriptPackages?: Record<string, { path: string; version: string }>;
  template?: { instanceId: string; packageKey: string; entryId: string; digest: string };
  resources?: Record<
    string,
    {
      path?: string;
      browserId?: string;
      provider?: 'deepseek' | 'openai-codex';
      model?: string;
      skill?: import('./skill').SkillVersionRef;
      source?: import('./conversation-archive').ConversationArchiveRef;
      result?: import('./contracts.generated').RunResultReference;
    }
  >;
  grants?: Record<string, 'deny' | 'confirm' | 'auto'>;
  configuration?: { adapter: string; schema: Json; values: Json; revision?: number };
};
export type FlowRecord = {
  templateResourceExtension?: import('./contracts.generated').TemplateResourceExtensionReceipt;
  desktopTarget?: import('./desktop-planning').DesktopTaskTarget;
  toolTargets?: import('./task-mcp-targets').TaskMcpTarget[];
  outputTarget?: import('./task-output').TaskOutputTarget;
  webTarget?: import('./task-web-target').TaskWebTarget;
  id: string;
  flow: Flow;
  bindings: Bindings;
  updatedAt: string;
  versionId?: string;
};
export type Run = {
  batch?: import('./entry-batches').BatchRunReference;
  task?: { id: string; revision: number };
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
  review?: { reviewedAt: string; desktopReviewed?: true; toolsReviewed?: true };
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
  deletedAt?: string;
  time: string;
  origin?: TemplateAttentionOrigin;
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
export type Bridge = {
  request(method: string, args?: any): Promise<any>;
  onmessage(
    listener: (
      event:
        | import('./conversation').ConversationEvent
        | import('./conversation-thread').ConversationThreadEvent
        | import('./conversation-archive').ArchiveEvent
        | import('./source-reduction').SourceReductionOutput,
    ) => void,
  ): () => void;
};
export type BrowserCommand = {
  direction?: 'up' | 'down';
  distance?: number;
  renderPolicy?:
    | 'bounded-selection-text-v1'
    | 'bounded-selection-text-v2'
    | 'bounded-visible-text-v1';
  version?: number;
  operation: string;
  selector?: string;
  framePath?: string[];
  value?: any;
  timeoutMs?: number;
  fields?: import('./browser-fields').ResolvedBrowserFieldsNode['fields'];
};
export type BrowserDriver = {
  perform(command: BrowserCommand): Promise<any>;
  close(): Promise<void>;
};
