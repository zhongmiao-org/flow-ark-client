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
    kind: 'file' | 'directory' | 'browser' | 'ai';
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
