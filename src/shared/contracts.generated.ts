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
      type: 'browser';
      version: 3;
      name?: string;
      timeoutMs?: number;
      operation:
        | 'navigate'
        | 'read'
        | 'click'
        | 'fill'
        | 'wait'
        | 'upload'
        | 'screenshot'
        | 'download'
        | 'select'
        | 'check'
        | 'inputValue'
        | 'press';
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
      type: 'excel';
      version: 3;
      operation: 'map';
      binding: string;
      name: Value;
      sheet: string;
      rows: Value;
      /**
       * @minItems 1
       * @maxItems 256
       */
      mappings: [ExcelColumnMapping, ...ExcelColumnMapping[]];
      includeHeaders: boolean;
      nullPolicy: 'blank';
      timeoutMs?: number;
    }
  | {
      id: string;
      type: 'file';
      version: 3;
      name: Value;
      timeoutMs?: number;
      operation: 'create';
      binding: string;
      content: Value;
    }
  | {
      id: string;
      type: 'file';
      version: 4;
      name: Value;
      timeoutMs?: number;
      operation: 'create';
      binding: string;
      content: Value;
      onConflict: 'number';
    }
  | {
      id: string;
      type: 'mcp';
      version: 1;
      name?: string;
      timeoutMs?: number;
      target: string;
      tool: string;
      arguments: Value;
    }
  | {
      id: string;
      type: 'desktop';
      version: 1;
      name?: string;
      timeoutMs?: number;
      target: string;
      operation: 'replace-selection';
      text: string;
    }
  | {
      id: string;
      name?: string;
      timeoutMs?: number;
      type: 'ai';
      version: 1;
      binding: string;
      instructions: string;
      input: Value;
      schema: {
        type: 'object';
        [k: string]: Json | 'object';
      };
    }
  | {
      id: string;
      type: 'conversation';
      version: 1;
      name?: string;
      timeoutMs?: number;
      binding: string;
      key: Value;
      title: string;
      instructions: string;
      input: Value;
      maxRequests: number;
    }
  | {
      id: string;
      type: 'document';
      version: 1;
      name?: string;
      timeoutMs?: number;
      binding: string;
      file: Value;
    }
  | {
      id: string;
      type: 'skill';
      version: 1;
      name?: string;
      timeoutMs?: number;
      operation: 'propose' | 'read';
      binding: string;
      key?: Value;
      title?: Value;
      markdown?: Value;
      data?: Value;
      evidence?: Value;
      base?: Value;
    }
  | {
      id: string;
      type: 'context';
      version: 1;
      name?: string;
      timeoutMs?: number;
      operation: 'configuration' | 'state.read' | 'state.write';
      expectedRevision?: Value;
      value?: Value;
    }
  | {
      id: string;
      type: 'browser';
      version: 4;
      name?: string;
      timeoutMs?: number;
      operation: 'url' | 'count' | 'attribute';
      selector:
        | string
        | {
            $ref: string;
          };
      value:
        | null
        | string
        | {
            $ref: string;
          };
      framePath: FramePath;
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
export type TemplateDataOwner =
  | {
      kind: 'instance';
      instanceId: string;
      package: {
        id: string;
        version: string;
        digest: string;
      };
      entryId: string;
    }
  | {
      kind: 'author-checkout';
      checkoutId: string;
      draftId: string;
      draftRevision: number;
      entryId: string;
    };
export type AIPlanningResult = {
  formatVersion: '1.0';
  kind: 'plan' | 'clarify' | 'unsupported';
  summary: string;
  flow: FlowDefinition | null;
  /**
   * @minItems 0
   * @maxItems 6
   */
  questions:
    | []
    | [AIPlanningQuestion]
    | [AIPlanningQuestion, AIPlanningQuestion]
    | [AIPlanningQuestion, AIPlanningQuestion, AIPlanningQuestion]
    | [AIPlanningQuestion, AIPlanningQuestion, AIPlanningQuestion, AIPlanningQuestion]
    | [AIPlanningQuestion, AIPlanningQuestion, AIPlanningQuestion, AIPlanningQuestion, AIPlanningQuestion]
    | [
        AIPlanningQuestion,
        AIPlanningQuestion,
        AIPlanningQuestion,
        AIPlanningQuestion,
        AIPlanningQuestion,
        AIPlanningQuestion
      ];
  /**
   * @minItems 0
   * @maxItems 20
   */
  limitations:
    | []
    | [string]
    | [string, string]
    | [string, string, string]
    | [string, string, string, string]
    | [string, string, string, string, string]
    | [string, string, string, string, string, string]
    | [string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string, string, string]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ];
};
export type ConversationOutput = {
  sessionId: string;
  status: 'draft' | 'generating' | 'ready' | 'failed' | 'cancelled' | 'confirmed';
  revision: number;
  /**
   * @maxItems 100
   */
  transcript: {
    role: 'user' | 'assistant';
    text: string;
  }[];
  sequence: number;
  evidence: ConversationEvidence | null;
};
export type DocumentResult = {
  version: 1;
  status: 'ready' | 'partial' | 'empty';
  source: DocumentSource;
  text: string;
  /**
   * @maxItems 1000
   */
  units: DocumentUnit[];
  /**
   * @maxItems 1100
   */
  warnings: DocumentWarning[];
};
export type SkillEvidence =
  | {
      kind: 'document';
      label: string;
      source: DocumentSource;
      /**
       * @minItems 1
       * @maxItems 1000
       */
      units: [number, ...number[]];
    }
  | ConversationEvidence
  | {
      kind: 'manual';
      label: string;
      note: string;
    };
export type SkillProposalSnapshot = {
  version: 1;
  id: string;
  revision: number;
  key: string;
  workspaceBinding: string;
  sourceFlowId: string;
  sourceNodeId: string;
  sourceFingerprint: string;
  base: SkillVersionRef | null;
  status: 'draft' | 'publishing' | 'confirmed' | 'conflict' | 'failed' | 'unknown' | 'discarded';
  draft: SkillDraft;
  createdAt: string;
  updatedAt: string;
  publication?: {
    requestId: string;
    versionId: string;
    draftSha256: string;
  };
  confirmed?: SkillVersionRef;
  error?: string;
};
export type SkillProposeOutput = {
  proposalId: string;
  revision: number;
  status: 'pending' | 'confirmed';
  ref: SkillVersionRef | null;
};
export type TemplateAuthorNeutralValue =
  | (null | '' | 0 | false)
  | TemplateAuthorNeutralValue[]
  | {
      [k: string]: TemplateAuthorNeutralValue;
    };
export type TemplateAuthorResource = {
  id: string;
  name: string;
  kind: 'file' | 'directory' | 'browser' | 'ai' | 'skill';
  access: 'read' | 'write' | 'readwrite' | 'use';
  required: boolean;
};
export type TemplateAuthorExportReceipt = {
  version: 1;
  id: string;
  draftId: string;
  revision: number;
  status: 'choosing' | 'writing' | 'written' | 'cancelled' | 'failed' | 'unknown';
  package: {
    id: string;
    version: string;
    contentDigest: string;
  };
  archiveSha256: string;
  bytes: number;
  createdAt: string;
  updatedAt: string;
  destination?: string;
  completedAt?: string;
  error?: string;
};
export type TemplateDataOutput = TemplateDataReadOutput | TemplateDataWriteOutput;
export type TemplateDataWriteReceipt =
  | {
      version: 1;
      contextId: string;
      operationId: string;
      requestSha256: string;
      createdAt: string;
      updatedAt: string;
      status: 'written';
      result: TemplateDataWriteOutput;
    }
  | {
      version: 1;
      contextId: string;
      operationId: string;
      requestSha256: string;
      createdAt: string;
      updatedAt: string;
      status: 'prepared' | 'unknown' | 'cancelled';
      error?: string;
    }
  | {
      version: 1;
      contextId: string;
      operationId: string;
      requestSha256: string;
      createdAt: string;
      updatedAt: string;
      status: 'conflict';
      currentRevision: number;
      error?: string;
    };
export type BrowserInspectionNode = {
  id: string;
  type: 'browser';
  version: 4;
  name?: string;
  timeoutMs?: number;
  operation: 'url' | 'count' | 'attribute';
  selector:
    | string
    | {
        $ref: string;
      };
  value:
    | null
    | string
    | {
        $ref: string;
      };
  framePath: FramePath;
};
export type BrowserInspectionResult = string | number | null;
export type TemplateAttentionOrigin = TemplateInstanceAttentionOrigin | TemplateAuthorAttentionOrigin;

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
  UserAttentionItem?: UserAttentionItem;
  TemplateManifest?: TemplateManifest;
  TemplateConfiguration?: TemplateConfiguration;
  TemplatePackage?: TemplatePackage;
  TemplateArchiveManifest?: TemplateArchiveManifest;
  AIRequest?: AIRequest;
  AIResult?: AIResult;
  TemplateInstanceRef?: TemplateInstanceRef;
  AIPlanningContext?: AIPlanningContext;
  AIPlanningQuestion?: AIPlanningQuestion;
  AIPlanningRequest?: AIPlanningRequest;
  AIPlanningResult?: AIPlanningResult;
  ExcelColumnMapping?: ExcelColumnMapping;
  McpToolResult?: McpToolResult;
  TemplateHumanReview?: TemplateHumanReview;
  ParameterSource?: ParameterSource;
  ConversationMessage?: ConversationMessage;
  ConversationAttempt?: ConversationAttempt;
  ConversationSnapshot?: ConversationSnapshot;
  ConversationEvent?: ConversationEvent;
  ConversationOutput?: ConversationOutput;
  DocumentSource?: DocumentSource;
  DocumentUnit?: DocumentUnit;
  DocumentWarning?: DocumentWarning;
  DocumentResult?: DocumentResult;
  SkillVersionRef?: SkillVersionRef;
  SkillEvidence?: SkillEvidence;
  SkillDraft?: SkillDraft;
  SkillFile?: SkillFile;
  SkillManifest?: SkillManifest;
  SkillVersion?: SkillVersion;
  SkillProposalSnapshot?: SkillProposalSnapshot;
  SkillProposeOutput?: SkillProposeOutput;
  TemplateAuthorNeutralValue?: TemplateAuthorNeutralValue;
  TemplateAuthorResource?: TemplateAuthorResource;
  TemplateAuthorAction?: TemplateAuthorAction;
  TemplateAuthorPrompt?: TemplateAuthorPrompt;
  TemplateAuthorPromptBinding?: TemplateAuthorPromptBinding;
  TemplateAuthorEntry?: TemplateAuthorEntry;
  TemplateAuthorAsset?: TemplateAuthorAsset;
  TemplateAuthorDefinition?: TemplateAuthorDefinition;
  TemplateAuthorDraft?: TemplateAuthorDraft;
  TemplateAuthorPackageMetadata?: TemplateAuthorPackageMetadata;
  TemplateAuthorCheckout?: TemplateAuthorCheckout;
  TemplateAuthorExportReceipt?: TemplateAuthorExportReceipt;
  TemplateDataOwner?: TemplateDataOwner;
  TemplateDataContext?: TemplateDataContext;
  TemplateDataState?: TemplateDataState;
  TemplateDataReadOutput?: TemplateDataReadOutput;
  TemplateDataWriteOutput?: TemplateDataWriteOutput;
  TemplateDataOutput?: TemplateDataOutput;
  TemplateDataWriteRequest?: TemplateDataWriteRequest;
  TemplateDataWriteReceipt?: TemplateDataWriteReceipt;
  TemplateDataEditRequest?: TemplateDataEditRequest;
  TemplateDataEditResult?: TemplateDataEditResult;
  ConversationEvidence?: ConversationEvidence;
  SkillTrialSource?: SkillTrialSource;
  SkillTrialPreview?: SkillTrialPreview;
  SkillTrialRequest?: SkillTrialRequest;
  SkillTrialResult?: SkillTrialResult;
  SkillTrialStatus?: SkillTrialStatus;
  BrowserInspectionNode?: BrowserInspectionNode;
  BrowserInspectionResult?: BrowserInspectionResult;
  TemplateAttentionOrigin?: TemplateAttentionOrigin;
  TemplateAttentionRecord?: TemplateAttentionRecord;
  TemplateAuthorSdkOwner?: TemplateAuthorSdkOwner;
  TemplateAuthorSdkContext?: TemplateAuthorSdkContext;
  TemplateAuthorSdkResult?: TemplateAuthorSdkResult;
  TemplateInstanceAttentionOrigin?: TemplateInstanceAttentionOrigin;
  TemplateAuthorAttentionOrigin?: TemplateAuthorAttentionOrigin;
}
export interface CredentialRef {
  credentialId: string;
}
export interface ArtifactRef {
  artifactId: string;
  runId: string;
}
export interface ExcelColumnMapping {
  source: string;
  column: string;
  header: string;
  type: 'text' | 'number' | 'boolean';
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
  parameterSources?: {
    [k: string]: ParameterSource;
  };
}
export interface ParameterSource {
  $ref: string;
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
  templateData?: TemplateDataContext;
  authorSdk?: TemplateAuthorSdkContext;
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
export interface TemplateDataContext {
  version: 1;
  id: string;
  owner: TemplateDataOwner;
  configurationRevision: number;
  configurationSchema: {
    [k: string]: Json;
  };
  stateSchema: {
    [k: string]: Json;
  };
  configuration: Json;
  schemaSha256: string;
  createdAt: string;
}
export interface TemplateAuthorSdkContext {
  version: 1;
  id: string;
  owner: TemplateAuthorSdkOwner;
  resultSchema: {
    [k: string]: Json;
  };
  /**
   * @maxItems 1000
   */
  capabilities: string[];
  definitionSha256: string;
  createdAt: string;
}
export interface TemplateAuthorSdkOwner {
  kind: 'author-checkout';
  checkoutId: string;
  draftId: string;
  entryId: string;
  flowId: string;
  baseRevision: number;
}
export interface RunEvent {
  runId: string;
  sequence: number;
  time: string;
  type: 'state' | 'node-start' | 'node-end' | 'log' | 'progress' | 'artifact' | 'error';
  nodeInstance: string;
  data: Json;
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
export interface TemplateArchiveManifest {
  packageFormat: '2.0';
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  source: string;
  minimumClientVersion: string;
  sdkVersion: '1.0';
  configurationSchema: string;
  stateSchema: string;
  /**
   * @maxItems 50
   */
  entries: {
    id: string;
    name: string;
    flow: string;
    inputSchema: string;
    resultSchema: string;
    schedulable: boolean;
    /**
     * @maxItems 100
     */
    capabilities: string[];
    /**
     * @maxItems 100
     */
    resources: string[];
    /**
     * @maxItems 100
     */
    actions: string[];
  }[];
  /**
   * @maxItems 100
   */
  resources: {
    id: string;
    name: string;
    kind: 'file' | 'directory' | 'browser' | 'ai' | 'skill';
    access: 'read' | 'write' | 'readwrite' | 'use';
    required: boolean;
  }[];
  /**
   * @maxItems 100
   */
  actions: {
    id: string;
    name: string;
    description: string;
    default: 'deny';
  }[];
  /**
   * @maxItems 512
   */
  files: {
    path: string;
    size: number;
    sha256: string;
  }[];
  /**
   * @maxItems 512
   */
  scripts: string[];
  /**
   * @maxItems 512
   */
  dependencies: {
    name: string;
    version: string;
    license: string;
  }[];
  contentDigest: string;
}
export interface AIRequest {
  provider: 'openai-codex' | 'deepseek';
  model: string;
  instructions: string;
  input: Json;
  schema: Json;
}
export interface AIResult {
  provider: 'openai-codex' | 'deepseek';
  model: string;
  requestId: string;
  output: Json;
  usage: Json;
}
export interface TemplateInstanceRef {
  packageId: string;
  version: string;
  digest: string;
  instanceId: string;
  entryId: string;
}
export interface AIPlanningContext {
  id: string;
  kind: 'text' | 'web' | 'file' | 'image' | 'application' | 'mcp';
  label: string;
  text: string;
}
export interface AIPlanningQuestion {
  id: string;
  prompt: string;
  /**
   * @minItems 0
   * @maxItems 6
   */
  options:
    | []
    | [string]
    | [string, string]
    | [string, string, string]
    | [string, string, string, string]
    | [string, string, string, string, string]
    | [string, string, string, string, string, string];
}
export interface AIPlanningRequest {
  formatVersion: '1.0';
  flowId: string;
  description: string;
  /**
   * @minItems 0
   * @maxItems 20
   */
  context:
    | []
    | [AIPlanningContext]
    | [AIPlanningContext, AIPlanningContext]
    | [AIPlanningContext, AIPlanningContext, AIPlanningContext]
    | [AIPlanningContext, AIPlanningContext, AIPlanningContext, AIPlanningContext]
    | [AIPlanningContext, AIPlanningContext, AIPlanningContext, AIPlanningContext, AIPlanningContext]
    | [AIPlanningContext, AIPlanningContext, AIPlanningContext, AIPlanningContext, AIPlanningContext, AIPlanningContext]
    | [
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext
      ]
    | [
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext
      ]
    | [
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext
      ]
    | [
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext
      ]
    | [
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext
      ]
    | [
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext
      ]
    | [
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext
      ]
    | [
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext
      ]
    | [
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext
      ]
    | [
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext
      ]
    | [
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext
      ]
    | [
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext
      ]
    | [
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext
      ]
    | [
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext,
        AIPlanningContext
      ];
  answers: {
    [k: string]: string;
  };
  baseFlow: FlowDefinition | null;
  /**
   * @minItems 0
   * @maxItems 100
   */
  capabilities: string[];
}
export interface McpToolResult {
  version: 1;
  /**
   * @maxItems 64
   */
  content: {
    [k: string]: Json;
  }[];
  structuredContent?: {
    [k: string]: Json;
  };
  isError: boolean;
}
export interface TemplateHumanReview {
  version: 1;
  target: string;
  content: string;
}
export interface ConversationMessage {
  id: string;
  turnId: string;
  role: 'user' | 'assistant';
  text: string;
  state: 'complete' | 'partial';
  requestId?: string;
}
export interface ConversationAttempt {
  id: string;
  turnId: string;
  state: 'generating' | 'complete' | 'failed' | 'cancelled';
  providerRequestId: string;
  model: string;
  usage: Json;
}
export interface ConversationSnapshot {
  formatVersion: '1.0';
  id: string;
  flowId: string;
  nodeId: string;
  title: string;
  fingerprint: string;
  provider: 'deepseek' | 'openai-codex';
  model: string;
  instructions: string;
  context: Json;
  maxRequests: number;
  status: 'draft' | 'generating' | 'ready' | 'failed' | 'cancelled' | 'confirmed';
  revision: number;
  sequence: number;
  draft: string;
  /**
   * @maxItems 100
   */
  messages: ConversationMessage[];
  /**
   * @maxItems 50
   */
  attempts: ConversationAttempt[];
  updatedAt: string;
  error: string;
  confirmedAt?: string;
  skillTrial?: SkillTrialSource;
}
export interface SkillTrialSource {
  version: 1;
  proposalId: string;
  revision: number;
  sha256: string;
}
export interface ConversationEvent {
  kind: 'conversation.snapshot';
  eventId: string;
  sessionId: string;
  sequence: number;
  requestId: string | null;
  turnId: string | null;
  snapshot: ConversationSnapshot;
}
export interface ConversationEvidence {
  kind: 'conversation';
  label: string;
  sessionId: string;
  revision: number;
  sequence: number;
  sha256: string;
}
export interface DocumentSource {
  binding: string;
  name: string;
  format: 'text' | 'pdf' | 'docx';
  byteLength: number;
  sha256: string;
}
export interface DocumentUnit {
  index: number;
  kind: 'line' | 'page' | 'paragraph';
  locator: string;
  text: string;
}
export interface DocumentWarning {
  code: 'empty-unit' | 'text-only' | 'body-only' | 'tracked-changes' | 'embedded-content';
  message: string;
  unit: number | null;
}
export interface SkillVersionRef {
  key: string;
  versionId: string;
  sha256: string;
}
export interface SkillDraft {
  title: string;
  markdown: string;
  data: {
    [k: string]: Json;
  };
  /**
   * @maxItems 100
   */
  evidence: SkillEvidence[];
}
export interface SkillFile {
  path: 'SKILL.md' | 'data.json';
  byteLength: number;
  sha256: string;
}
export interface SkillManifest {
  version: 1;
  key: string;
  versionId: string;
  operationId: string;
  title: string;
  parent: SkillVersionRef | null;
  confirmedAt: string;
  /**
   * @minItems 2
   * @maxItems 2
   */
  files: [SkillFile, SkillFile];
}
export interface SkillVersion {
  version: 1;
  ref: SkillVersionRef;
  title: string;
  parent: SkillVersionRef | null;
  confirmedAt: string;
  markdown: string;
  data: {
    [k: string]: Json;
  };
  /**
   * @maxItems 100
   */
  evidence: SkillEvidence[];
}
export interface TemplateAuthorAction {
  id: string;
  name: string;
  description: string;
  default: 'deny';
}
export interface TemplateAuthorPrompt {
  id: string;
  name: string;
  body: string;
}
export interface TemplateAuthorPromptBinding {
  nodeId: string;
  field: 'instructions';
  promptId: string;
}
export interface TemplateAuthorEntry {
  id: string;
  name: string;
  flow: FlowDefinition & {
    parameters?: {
      [k: string]: TemplateAuthorNeutralValue;
    };
    [k: string]: any;
  };
  inputSchema: {
    [k: string]: any;
  };
  resultSchema: {
    [k: string]: any;
  };
  schedulable: boolean;
  /**
   * @minItems 0
   * @maxItems 100
   */
  capabilities: string[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  resourceIds: string[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  actionIds: string[];
  /**
   * @minItems 0
   * @maxItems 1000
   */
  promptBindings: TemplateAuthorPromptBinding[];
}
export interface TemplateAuthorAsset {
  path: string;
  encoding: 'utf8' | 'base64';
  body: string;
}
export interface TemplateAuthorDefinition {
  version: 1;
  metadata: {
    id: string;
    name: string;
    description: string;
    version: string;
    author: string;
    source: string;
    minimumClientVersion: string;
  };
  configurationSchema: {
    [k: string]: any;
  };
  stateSchema: {
    [k: string]: any;
  };
  /**
   * @minItems 0
   * @maxItems 50
   */
  entries: TemplateAuthorEntry[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  resources: TemplateAuthorResource[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  actions: TemplateAuthorAction[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  prompts: TemplateAuthorPrompt[];
  readme: string;
  /**
   * @minItems 0
   * @maxItems 100
   */
  assets: TemplateAuthorAsset[];
  /**
   * @maxItems 512
   */
  dependencies: {
    name: string;
    version: string;
    license: string;
  }[];
}
export interface TemplateAuthorDraft {
  version: 1;
  id: string;
  revision: number;
  definition: TemplateAuthorDefinition;
  createdAt: string;
  updatedAt: string;
}
export interface TemplateAuthorPackageMetadata {
  version: 1;
  /**
   * @minItems 0
   * @maxItems 100
   */
  prompts: {
    id: string;
    name: string;
    path: string;
  }[];
  /**
   * @minItems 0
   * @maxItems 1000
   */
  bindings: {
    entryId: string;
    nodeId: string;
    field: 'instructions';
    promptId: string;
  }[];
}
export interface TemplateAuthorCheckout {
  version: 1;
  id: string;
  draftId: string;
  entryId: string;
  baseRevision: number;
  flowId: string;
  baseFlowSha256: string;
  createdAt: string;
}
export interface TemplateDataState {
  version: 1;
  contextId: string;
  revision: number;
  value: Json;
  updatedAt: string;
}
export interface TemplateDataReadOutput {
  version: 1;
  operation: 'configuration' | 'state.read';
  contextId: string;
  revision: number;
  value: Json;
}
export interface TemplateDataWriteOutput {
  version: 1;
  operation: 'state.write';
  contextId: string;
  operationId: string;
  previousRevision: number;
  revision: number;
  value: Json;
  committedAt: string;
}
export interface TemplateDataWriteRequest {
  version: 1;
  contextId: string;
  operationId: string;
  runId: string;
  nodeInstance: string;
  expectedRevision: number;
  value: Json;
}
export interface TemplateDataEditRequest {
  version: 1;
  checkoutId: string;
  requestId: string;
  expectedConfigurationRevision: number;
  expectedStateRevision: number;
  configuration: Json;
  state: Json;
}
export interface TemplateDataEditResult {
  version: 1;
  requestId: string;
  context: TemplateDataContext;
  state: TemplateDataState;
}
export interface SkillTrialPreview {
  version: 1;
  source: SkillTrialSource;
  key: string;
  base: SkillVersionRef | null;
  draft: SkillDraft;
}
export interface SkillTrialRequest {
  version: 1;
  requestId: string;
  source: SkillTrialSource;
  provider: 'deepseek' | 'openai-codex';
  model: string;
  instructions: string;
}
export interface SkillTrialResult {
  version: 1;
  requestId: string;
  source: SkillTrialSource;
  sessionId: string;
}
export interface SkillTrialStatus {
  version: 1;
  source: SkillTrialSource;
  current: {
    revision: number;
    sha256: string;
    status: 'draft' | 'publishing' | 'confirmed' | 'conflict' | 'failed' | 'unknown' | 'discarded';
  } | null;
  usable: boolean;
  reason: 'ready' | 'changed' | 'unavailable' | 'workspace' | 'blocked';
  message: string;
}
export interface TemplateInstanceAttentionOrigin {
  version: 1;
  runId: string;
  instanceId: string;
  entryId: string;
}
export interface TemplateAuthorAttentionOrigin {
  version: 2;
  runId: string;
  checkoutId: string;
  draftId: string;
  entryId: string;
  baseRevision: number;
}
export interface TemplateAttentionRecord {
  id: string;
  kind: 'template';
  title: string;
  detail: Json;
  dedupeKey: string;
  read: boolean;
  time: string;
  origin?: TemplateAttentionOrigin;
}
export interface TemplateAuthorSdkResult {
  version: 1;
  runId: string;
  contextId: string;
  definitionSha256: string;
  value: Json;
  createdAt: string;
}
