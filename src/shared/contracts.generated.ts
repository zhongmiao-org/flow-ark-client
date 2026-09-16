/* Generated from pinned contracts/p1.schema.json. Do not edit. */

/**
 * @maxItems 8
 */
export type FramePath =
  | []
  | [string]
  | [string, string]
  | [string, string, string]
  | [string, string, string, string]
  | [string, string, string, string, string]
  | [string, string, string, string, string, string]
  | [string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string];
export type Node =
  | {
      id: string;
      type: 'value';
      version: 1;
      name?: string;
      timeoutMs?: number;
      value: Value;
    }
  | {
      id: string;
      type: 'assert';
      version: 1;
      name?: string;
      timeoutMs?: number;
      actual: Value;
      operator: 'equals' | 'notEquals' | 'contains' | 'gt' | 'exists';
      expected: Value;
    }
  | {
      id: string;
      type: 'http';
      version: 1;
      name?: string;
      timeoutMs?: number;
      url: Value;
      method: 'GET' | 'POST' | 'PUT' | 'DELETE';
      headers: Value;
      body: Value;
    }
  | {
      id: string;
      type: 'script';
      version: 1;
      name?: string;
      timeoutMs?: number;
      language: 'js' | 'ts';
      code: string;
      input: Value;
      /**
       * @maxItems 1000
       */
      dependencies: {
        name: string;
        version: string;
      }[];
    }
  | {
      id: string;
      type: 'file';
      version: 1;
      name: Value;
      timeoutMs?: number;
      operation: 'read' | 'write' | 'copy';
      binding: string;
      content: Value;
    }
  | {
      id: string;
      type: 'excel';
      version: 1;
      name: Value;
      timeoutMs?: number;
      operation: 'read' | 'write';
      binding: string;
      rows: Value;
    }
  | {
      id: string;
      type: 'excel';
      version: 2;
      name: Value;
      timeoutMs?: number;
      operation: 'fill';
      binding: string;
      templateName: Value;
      sheet: string;
      cells: Value;
    }
  | {
      id: string;
      type: 'file';
      version: 2;
      name: Value;
      timeoutMs?: number;
      operation: 'archive';
      binding: string;
      files: Value;
    }
  | {
      id: string;
      type: 'browser';
      version: 1;
      name?: string;
      timeoutMs?: number;
      operation: 'navigate' | 'read' | 'click' | 'fill' | 'wait' | 'upload' | 'screenshot' | 'download';
      selector: string;
      value: Value;
    }
  | {
      id: string;
      type: 'browser';
      version: 2;
      name?: string;
      timeoutMs?: number;
      operation: 'navigate' | 'read' | 'click' | 'fill' | 'wait' | 'upload' | 'screenshot' | 'download';
      selector: string;
      value: Value;
      framePath: FramePath;
    }
  | {
      id: string;
      type: 'human';
      version: 1;
      name?: string;
      timeoutMs?: number;
      message: string;
    }
  | {
      id: string;
      type: 'condition';
      version: 1;
      name?: string;
      timeoutMs?: number;
      actual: Value;
      operator: 'equals' | 'notEquals' | 'contains' | 'gt' | 'exists';
      expected: Value;
      /**
       * @maxItems 1000
       */
      then: Node[];
      /**
       * @maxItems 1000
       */
      else: Node[];
    }
  | {
      id: string;
      type: 'loop';
      version: 1;
      name?: string;
      timeoutMs?: number;
      items: Value;
      /**
       * @maxItems 1000
       */
      body: Node[];
    }
  | {
      id: string;
      type: 'recruiting';
      version: 1;
      name?: string;
      timeoutMs?: number;
      platform: 'boss' | 'zhaopin';
      batchLimit: number;
    };
export type Value =
  | Json
  | {
      $ref: string;
    };
export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | {
      [k: string]: Json;
    };
export type RunState =
  | 'QUEUED'
  | 'RUNNING'
  | 'PAUSED'
  | 'WAITING_INPUT'
  | 'CANCELLING'
  | 'CANCELLED'
  | 'INTERRUPTED'
  | 'SUCCEEDED'
  | 'FAILED';

export interface FlowArkP1 {
  CredentialRef?: CredentialRef;
  ArtifactRef?: ArtifactRef;
  FramePath?: FramePath;
  Node?: Node;
  FlowDefinition?: FlowDefinition;
  RunState?: RunState;
  RunRequest?: RunRequest;
  RunSnapshot?: RunSnapshot;
  ScriptBundle?: ScriptBundle;
  RunEvent?: RunEvent;
  RecruitingPolicy?: RecruitingPolicy;
  AIReplyDraft?: AIReplyDraft;
  AIReplyRequest?: AIReplyRequest;
  AIReplyResult?: AIReplyResult;
  RecruitingAction?: RecruitingAction;
  ContactExchangeResult?: ContactExchangeResult;
  UserAttentionItem?: UserAttentionItem;
  RecruitingJobFilter?: RecruitingJobFilter;
  JobSalary?: JobSalary;
  RecruitingJobSnapshot?: RecruitingJobSnapshot;
  TemplateManifest?: TemplateManifest;
  TemplateConfiguration?: TemplateConfiguration;
  TemplatePackage?: TemplatePackage;
}
export interface CredentialRef {
  credentialId: string;
}
export interface ArtifactRef {
  artifactId: string;
  runId: string;
}
export interface FlowDefinition {
  formatVersion: '1.0';
  id: string;
  name: string;
  description: string;
  parameters: {
    [k: string]: Json;
  };
  /**
   * @maxItems 1000
   */
  steps: Node[];
  /**
   * @maxItems 1000
   */
  requiredCapabilities: string[];
  sourceTemplate?: {
    id: string;
    version: string;
    digest: string;
  };
}
export interface RunRequest {
  flowId: string;
  versionId: string;
  parameters: Json;
  source: 'manual' | 'schedule';
  triggerId: string;
}
export interface RunSnapshot {
  runId: string;
  versionId: string;
  flow: FlowDefinition;
  parameters: Json;
  createdAt: string;
  /**
   * @maxItems 1000
   */
  scriptBundles?: ScriptBundle[];
}
export interface ScriptBundle {
  nodeId: string;
  sha256: string;
  /**
   * @maxItems 1000
   */
  dependencies: {
    name: string;
    version: string;
  }[];
}
export interface RunEvent {
  runId: string;
  sequence: number;
  time: string;
  type: 'state' | 'node-start' | 'node-end' | 'log' | 'progress' | 'artifact' | 'error';
  nodeInstance: string;
  data: Json;
}
export interface RecruitingPolicy {
  platform: 'boss' | 'zhaopin';
  account: string;
  /**
   * @maxItems 1000
   */
  keywords: string[];
  /**
   * @maxItems 1000
   */
  excludedCompanies: string[];
  /**
   * @maxItems 1000
   */
  allowedTargets: string[];
  resumeVersion: string;
  resumeBinding: string;
  /**
   * @maxItems 1000
   */
  facts: {
    id: string;
    text: string;
  }[];
  actions: {
    apply: 'deny' | 'confirm' | 'auto';
    resume: 'deny' | 'confirm' | 'auto';
    reply: 'deny' | 'confirm' | 'auto';
    requestWechat: 'deny' | 'confirm' | 'auto';
    acceptWechat: 'deny' | 'confirm' | 'auto';
    requestPhone: 'deny' | 'confirm' | 'auto';
    acceptPhone: 'deny' | 'confirm' | 'auto';
  };
  dailyLimit: number;
  batchLimit: number;
  startHour: number;
  endHour: number;
  timezone: string;
  ownWechat: string;
  ownPhone: string;
  provider: 'openai-codex' | 'deepseek';
  model: string;
  contextRevision: string;
  jobFilter?: RecruitingJobFilter;
}
export interface RecruitingJobFilter {
  /**
   * @maxItems 1000
   */
  cities: string[];
  /**
   * @maxItems 1000
   */
  includedCompanies: string[];
  /**
   * @maxItems 1000
   */
  excludedKeywords: string[];
  /**
   * @maxItems 1000
   */
  workModes: ('onsite' | 'hybrid' | 'remote')[];
  salary: {
    enabled: boolean;
    minimumMonthly: number;
    maximumMonthly: number;
    currency: 'CNY';
  };
}
export interface AIReplyDraft {
  body: string;
  /**
   * @maxItems 1000
   */
  factIds: string[];
  /**
   * @maxItems 1000
   */
  claims: {
    text: string;
    factId: string;
  }[];
  containsContact: boolean;
  containsCommitment: boolean;
  /**
   * @maxItems 1000
   */
  needsHuman: string[];
}
export interface AIReplyRequest {
  provider: 'openai-codex' | 'deepseek';
  model: string;
  /**
   * @maxItems 1000
   */
  facts: {
    id: string;
    text: string;
  }[];
  /**
   * @maxItems 1000
   */
  conversation: {
    role: 'self' | 'peer';
    text: string;
  }[];
  job: string;
  contextHash: string;
  resumeVersion: string;
}
export interface AIReplyResult {
  provider: string;
  model: string;
  contextHash: string;
  resumeVersion: string;
  draft: AIReplyDraft;
  requestId: string;
  usage: Json;
}
export interface RecruitingAction {
  id: string;
  platform: 'boss' | 'zhaopin';
  account: string;
  target: string;
  kind: 'apply' | 'resume' | 'reply' | 'requestWechat' | 'acceptWechat' | 'requestPhone' | 'acceptPhone';
  contextHash: string;
  contentHash: string;
  dedupeKey: string;
  state:
    'PENDING_CONFIRMATION' | 'READY' | 'SUBMITTING' | 'CONFIRMED' | 'WAITING_PEER' | 'FAILED' | 'UNKNOWN' | 'BLOCKED';
  evidence: string;
  jobSnapshot?: RecruitingJobSnapshot;
}
export interface RecruitingJobSnapshot {
  title: string;
  company: string;
  city: string | null;
  workMode: ('onsite' | 'hybrid' | 'remote') | null;
  salary: JobSalary | null;
  source: string;
  observedAt: string;
}
export interface JobSalary {
  minimum: number;
  maximum: number;
  currency: string;
  period: 'month' | 'year' | 'day' | 'hour';
}
export interface ContactExchangeResult {
  platform: 'boss' | 'zhaopin';
  account: string;
  target: string;
  company: string;
  job: string;
  contact: string;
  kind: 'wechat' | 'phone';
  state: 'requested' | 'accepted' | 'rejected' | 'visible' | 'needs-human';
  value: string;
  source: string;
  owner: 'peer' | 'self' | 'unknown';
  time: string;
}
export interface UserAttentionItem {
  id: string;
  kind: 'contact' | 'confirmation' | 'unknown-result' | 'limitation' | 'login';
  title: string;
  detail: Json;
  dedupeKey: string;
  read: boolean;
  time: string;
}
export interface TemplateManifest {
  id: string;
  version: string;
  source: string;
  digest: string;
  formatVersion: '1.0';
  parametersSchema: Json;
  /**
   * @maxItems 1000
   */
  requiredCapabilities: string[];
  /**
   * @maxItems 1000
   */
  scripts: string[];
  /**
   * @maxItems 1000
   */
  dependencies: {
    name: string;
    version: string;
  }[];
  configuration?: TemplateConfiguration;
}
export interface TemplateConfiguration {
  adapter: string;
  schema: Json;
}
export interface TemplatePackage {
  manifest: TemplateManifest;
  flow: FlowDefinition;
}
