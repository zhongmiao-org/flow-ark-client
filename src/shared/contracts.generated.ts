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
      name?: string;
      timeoutMs?: number;
      type: 'ai';
      version: 2;
      binding: string;
      instructions: string;
      input: Value;
      schema: {
        type: 'object';
        [k: string]: Json | 'object';
      };
      failureMode: 'stop' | 'result';
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
    }
  | {
      id: string;
      type: 'conversation';
      version: 2;
      name?: string;
      timeoutMs?: number;
      binding: string;
      key: Value;
      title: string;
      instructions: string;
      input: Value;
      historyWindow: number;
    }
  | {
      id: string;
      type: 'source';
      version: 1;
      name: string;
      timeoutMs?: number;
      binding: string;
      operation: 'manifest';
    }
  | {
      id: string;
      type: 'source';
      version: 1;
      name: string;
      timeoutMs?: number;
      binding: string;
      operation: 'read';
      cursor: Value;
    }
  | {
      id: string;
      type: 'source-reduce';
      version: 1;
      name?: string;
      timeoutMs?: number;
      binding: string;
      aiBinding: string;
      instructions: string;
      schema: {
        [k: string]: Json;
      };
      seed: Value;
      maxRequests: number;
    }
  | {
      id: string;
      type: 'skill';
      version: 2;
      operation: 'propose-update';
      binding: string;
      base: Value;
      title: Value;
      markdown: Value;
      data: Value;
      evidence: Value;
      name?: string;
      timeoutMs?: number;
    }
  | {
      id: string;
      type: 'browser';
      version: 5;
      name?: string;
      timeoutMs?: number;
      operation: 'collect';
      selector:
        | string
        | {
            $ref: string;
          };
      framePath: FramePath;
      /**
       * @minItems 1
       * @maxItems 20
       */
      fields:
        | [BrowserField]
        | [BrowserField, BrowserField]
        | [BrowserField, BrowserField, BrowserField]
        | [BrowserField, BrowserField, BrowserField, BrowserField]
        | [BrowserField, BrowserField, BrowserField, BrowserField, BrowserField]
        | [BrowserField, BrowserField, BrowserField, BrowserField, BrowserField, BrowserField]
        | [BrowserField, BrowserField, BrowserField, BrowserField, BrowserField, BrowserField, BrowserField]
        | [
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField
          ]
        | [
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField
          ]
        | [
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField
          ]
        | [
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField
          ]
        | [
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField
          ]
        | [
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField
          ]
        | [
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField
          ]
        | [
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField
          ]
        | [
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField
          ]
        | [
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField
          ]
        | [
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField
          ]
        | [
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField
          ]
        | [
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField,
            BrowserField
          ];
    }
  | {
      id: string;
      type: 'browser';
      version: 6;
      name?: string;
      timeoutMs?: number;
      operation: 'collect';
      selector:
        | string
        | {
            $ref: string;
          };
      framePath: FramePath;
      /**
       * @minItems 1
       * @maxItems 20
       */
      fields:
        | [BrowserRenderedField]
        | [BrowserRenderedField, BrowserRenderedField]
        | [BrowserRenderedField, BrowserRenderedField, BrowserRenderedField]
        | [BrowserRenderedField, BrowserRenderedField, BrowserRenderedField, BrowserRenderedField]
        | [BrowserRenderedField, BrowserRenderedField, BrowserRenderedField, BrowserRenderedField, BrowserRenderedField]
        | [
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField
          ]
        | [
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField
          ]
        | [
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField
          ]
        | [
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField
          ]
        | [
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField
          ]
        | [
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField
          ]
        | [
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField
          ]
        | [
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField
          ]
        | [
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField
          ]
        | [
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField
          ]
        | [
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField
          ]
        | [
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField
          ]
        | [
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField
          ]
        | [
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField
          ]
        | [
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField,
            BrowserRenderedField
          ];
    }
  | {
      id: string;
      type: 'effect';
      version: 1;
      name?: string;
      timeoutMs?: number;
      operation: 'prepare';
      action: string;
      key:
        | string
        | {
            $ref: string;
          };
      description?:
        | string
        | {
            $ref: string;
          };
      review?: null | {
        version: 1;
        target:
          | string
          | {
              $ref: string;
            };
        content:
          | string
          | {
              $ref: string;
            };
      };
    }
  | {
      id: string;
      type: 'effect';
      version: 1;
      name?: string;
      timeoutMs?: number;
      operation: 'resolve';
      receipt: Value;
      state: 'confirmed' | 'failed' | 'unknown';
      evidence?: Value;
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
export type BrowserField = {
  key: string;
  selector:
    | string
    | {
        $ref: string;
      };
  operation: 'text' | 'attribute';
  attribute:
    | string
    | {
        $ref: string;
      }
    | null;
  required: boolean;
};
export type BrowserRenderedField = {
  key: string;
  selector:
    | string
    | {
        $ref: string;
      };
  operation: 'text' | 'attribute' | 'rendered-text';
  attribute:
    | string
    | {
        $ref: string;
      }
    | null;
  required: boolean;
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
    }
  | ConversationCheckpointEvidence
  | SourceReductionEvidence;
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
  kind: 'file' | 'directory' | 'browser' | 'ai' | 'skill' | 'conversation-source';
  access: 'read' | 'write' | 'readwrite' | 'use';
  required: boolean;
  /**
   * Optional single-hop logical directory source for explicit resource-editor draft defaults; never a runtime binding fallback.
   */
  defaultDirectoryFrom?: string;
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
export type AIRequestError =
  | {
      code: 'authentication';
      message: 'AI 服务拒绝鉴权，请检查自己的 Key 与模型权限。';
      httpStatus: 401 | 403;
    }
  | {
      code: 'rate-limit';
      message: 'AI 服务限流，请稍后自行重新运行。';
      httpStatus: 429;
    }
  | {
      code: 'http';
      message: 'AI 接口返回请求错误，请核对服务状态与请求配置。';
      httpStatus: number;
    }
  | {
      code: 'network';
      message: 'AI 网络请求未完成，请核对连接后自行重新运行。';
      httpStatus: null | number;
    }
  | {
      code: 'request-timeout';
      message: 'AI 请求等待超时，未采用结果；不会自动重试。';
      httpStatus: null | number;
    }
  | {
      code: 'refused';
      message: 'AI 服务拒绝生成，未采用正文。';
      httpStatus: null | number;
    }
  | {
      code: 'incomplete';
      message: 'AI 未返回完整结果，未采用部分正文。';
      httpStatus: null | number;
    }
  | {
      code: 'invalid-response';
      message: 'AI 响应或输出格式无效，未采用正文。';
      httpStatus: null | number;
    };
export type AIUsage = null | {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
    reasoning_tokens?: number;
    audio_tokens?: number;
    accepted_prediction_tokens?: number;
    rejected_prediction_tokens?: number;
  };
  completion_tokens_details?: {
    cached_tokens?: number;
    reasoning_tokens?: number;
    audio_tokens?: number;
    accepted_prediction_tokens?: number;
    rejected_prediction_tokens?: number;
  };
  input_tokens_details?: {
    cached_tokens?: number;
    reasoning_tokens?: number;
    audio_tokens?: number;
    accepted_prediction_tokens?: number;
    rejected_prediction_tokens?: number;
  };
  output_tokens_details?: {
    cached_tokens?: number;
    reasoning_tokens?: number;
    audio_tokens?: number;
    accepted_prediction_tokens?: number;
    rejected_prediction_tokens?: number;
  };
};
export type AIOutcome =
  | {
      status: 'success';
      result: AIResult & {
        model?: string;
        requestId?: string;
        usage?: AIUsage;
        [k: string]: any;
      };
    }
  | AIRequestFailure;
export type AINodeReceipt =
  | {
      status: 'success';
      provider: 'openai-codex' | 'deepseek';
      model: string;
      requestId: null | string;
      usage: AIUsage;
    }
  | AIRequestFailure;
export type EntryHandoffReceipt = {
  version: 1;
  requestId: string;
  selection: EntryHandoffSelection;
  token: string;
  revision: number;
  status: 'stopping' | 'created' | 'failed' | 'interrupted';
  /**
   * @minItems 1
   * @maxItems 100
   */
  stoppedRunIds: [string, ...string[]];
  runId: string | null;
  createdAt: string;
  updatedAt: string;
  error: string | null;
};
export type ConversationHistoryRef =
  | {
      kind: 'origin';
      requestId: string;
    }
  | {
      kind: 'history';
      ordinal: number;
      sha256: string;
    };
/**
 * @minItems 0
 * @maxItems 24
 */
export type ConversationHistorySelection = ConversationHistoryRef[];
export type ConversationThreadOrigin = ConversationEvidence | null;
export type ConversationThreadOutput = {
  formatVersion: '2.0';
  sessionId: string;
  status: 'pending' | 'confirmed' | 'context-review';
  revision: number;
  sequence: number;
  context: ConversationContextRef;
  historyCount: number;
  historyHash: string;
  origin: ConversationThreadOrigin;
  /**
   * @minItems 0
   * @maxItems 48
   */
  transcript: {
    role: 'user' | 'assistant';
    text: string;
    messageId: string;
    requestId: string;
  }[];
  evidence: ConversationCheckpointEvidence | null;
  proposalId: string | null;
};
export type SkillUpdateState =
  | {
      present: false;
    }
  | {
      present: true;
      value: Json;
    };
export type SkillUpdateTarget =
  | {
      area: 'title' | 'markdown';
      /**
       * @maxItems 0
       */
      path: [];
    }
  | {
      area: 'data';
      /**
       * @minItems 1
       * @maxItems 32
       */
      path: [string, ...string[]];
    };
export type SkillUpdateProposalOutput =
  | {
      version: 1;
      status: 'pending';
      base: SkillVersionRef;
      proposalId: string;
      revision: number;
    }
  | {
      version: 1;
      status: 'confirmed';
      base: SkillVersionRef;
      proposalId: string;
      revision: number;
      ref: SkillVersionRef;
    }
  | {
      version: 1;
      status: 'unchanged';
      base: SkillVersionRef;
    };
export type SkillUpdateApplication = {
  status: 'pending' | 'applied' | 'rejected';
  input: SkillUpdateApply;
  receipt: SkillUpdateReceipt | null;
};
export type EffectNode = EffectPrepareNode | EffectResolveNode;
export type EffectPrepareResult = {
  version: 1;
  operation: 'prepare';
  id: string;
  action: string;
  key: string;
  runId: string;
  execute: boolean;
  state: 'submitting' | 'confirmed' | 'failed' | 'unknown';
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
  AIRequestError?: AIRequestError;
  AIRequestFailure?: AIRequestFailure;
  AIOutcome?: AIOutcome;
  AINodeReceipt?: AINodeReceipt;
  AIUsage?: AIUsage;
  EntryHandoffSelection?: EntryHandoffSelection;
  EntryHandoffPreview?: EntryHandoffPreview;
  EntryHandoffRequest?: EntryHandoffRequest;
  EntryHandoffReceipt?: EntryHandoffReceipt;
  ConversationContextRef?: ConversationContextRef;
  ConversationContext?: ConversationContext;
  ConversationHistoryRef?: ConversationHistoryRef;
  ConversationHistorySelection?: ConversationHistorySelection;
  ConversationHistoryCursor?: ConversationHistoryCursor;
  ConversationThreadOrigin?: ConversationThreadOrigin;
  ConversationThreadInput?: ConversationThreadInput;
  ConversationThreadPrepared?: ConversationThreadPrepared;
  ConversationThreadEntry?: ConversationThreadEntry;
  ConversationThreadActive?: ConversationThreadActive;
  ConversationCheckpointEvidence?: ConversationCheckpointEvidence;
  ConversationThreadSnapshot?: ConversationThreadSnapshot;
  ConversationThreadEvent?: ConversationThreadEvent;
  ConversationHistoryPage?: ConversationHistoryPage;
  ConversationContextProposal?: ConversationContextProposal;
  ConversationCheckpoint?: ConversationCheckpoint;
  ConversationThreadOutput?: ConversationThreadOutput;
  ConversationArchiveCapture?: ConversationArchiveCapture;
  ConversationArchiveRef?: ConversationArchiveRef;
  ConversationArchiveRecord?: ConversationArchiveRecord;
  ConversationArchiveManifest?: ConversationArchiveManifest;
  ConversationArchiveCursor?: ConversationArchiveCursor;
  ConversationArchivePage?: ConversationArchivePage;
  ConversationSourceCursor?: ConversationSourceCursor;
  ConversationSourceChunk?: ConversationSourceChunk;
  ConversationSourceRead?: ConversationSourceRead;
  ConversationSourceManifestOutput?: ConversationSourceManifestOutput;
  SourceReductionRecipe?: SourceReductionRecipe;
  SourceReductionRef?: SourceReductionRef;
  SourceReductionCheckpoint?: SourceReductionCheckpoint;
  SourceReductionTransport?: SourceReductionTransport;
  SourceReductionAttempt?: SourceReductionAttempt;
  SourceReductionProof?: SourceReductionProof;
  SourceReductionEvidence?: SourceReductionEvidence;
  SourceReductionOutput?: SourceReductionOutput;
  SourceReductionReviewTarget?: SourceReductionReviewTarget;
  SourceReductionReviewSelection?: SourceReductionReviewSelection;
  SourceReductionReviewCheckpoint?: SourceReductionReviewCheckpoint;
  SourceReductionReviewFragment?: SourceReductionReviewFragment;
  SourceReductionReviewPending?: SourceReductionReviewPending;
  SourceReductionRunReview?: SourceReductionRunReview;
  SourceReductionRunConfirmation?: SourceReductionRunConfirmation;
  SourceReductionRunReviewReceipt?: SourceReductionRunReviewReceipt;
  SkillUpdateContent?: SkillUpdateContent;
  SkillUpdateState?: SkillUpdateState;
  SkillUpdateTarget?: SkillUpdateTarget;
  SkillUpdateField?: SkillUpdateField;
  SkillUpdateReview?: SkillUpdateReview;
  SkillUpdateChoice?: SkillUpdateChoice;
  SkillUpdateSelection?: SkillUpdateSelection;
  SkillUpdateApply?: SkillUpdateApply;
  SkillUpdateReceipt?: SkillUpdateReceipt;
  SkillUpdateOrigin?: SkillUpdateOrigin;
  SkillUpdateBundle?: SkillUpdateBundle;
  SkillUpdateInfo?: SkillUpdateInfo;
  SkillUpdateInput?: SkillUpdateInput;
  SkillUpdateProposalOutput?: SkillUpdateProposalOutput;
  SkillUpdateApplication?: SkillUpdateApplication;
  SkillUpdateDetail?: SkillUpdateDetail;
  BrowserField?: BrowserField;
  BrowserFieldsNode?: BrowserFieldsNode;
  BrowserFieldResult?: BrowserFieldResult;
  BrowserFieldsResult?: BrowserFieldsResult;
  BrowserRenderedField?: BrowserRenderedField;
  BrowserRenderedFieldsNode?: BrowserRenderedFieldsNode;
  BrowserRenderedFieldResult?: BrowserRenderedFieldResult;
  BrowserRenderedFieldsResult?: BrowserRenderedFieldsResult;
  EffectPrepareNode?: EffectPrepareNode;
  EffectResolveNode?: EffectResolveNode;
  EffectNode?: EffectNode;
  EffectPrepareResult?: EffectPrepareResult;
  EffectResolveResult?: EffectResolveResult;
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
    kind: 'file' | 'directory' | 'browser' | 'ai' | 'skill' | 'conversation-source';
    access: 'read' | 'write' | 'readwrite' | 'use';
    required: boolean;
    /**
     * Optional single-hop logical directory source for explicit resource-editor draft defaults; never a runtime binding fallback.
     */
    defaultDirectoryFrom?: string;
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
export interface ConversationCheckpointEvidence {
  kind: 'conversation-checkpoint';
  label: string;
  sessionId: string;
  checkpointId: string;
  sha256: string;
}
export interface SourceReductionEvidence {
  kind: 'source-reduction';
  label: string;
  proof: SourceReductionProof;
}
export interface SourceReductionProof {
  version: 1;
  job: SourceReductionRef;
  checkpointSha256: string;
  accumulatorSha256: string;
  chainHash: string;
  chunks: number;
  records: number;
  bytes: number;
  sha256: string;
}
export interface SourceReductionRef {
  version: 1;
  jobId: string;
  source: ConversationArchiveRef;
  recipeHash: string;
}
export interface ConversationArchiveRef {
  version: 1;
  archiveId: string;
  sessionId: string;
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
export interface AIRequestFailure {
  status: 'failed';
  provider: 'openai-codex' | 'deepseek';
  model: string;
  requestId: null | string;
  usage: AIUsage;
  error: AIRequestError;
}
export interface EntryHandoffSelection {
  flowId: string;
  source: {
    instanceId: string;
    entryId: string;
    revision: string;
  };
}
export interface EntryHandoffPreview {
  version: 1;
  selection: EntryHandoffSelection;
  token: string;
  expiresAt: string;
  flowName: string;
  instanceName: string;
  packageVersion: string;
  packageDigest: string;
  /**
   * @minItems 1
   * @maxItems 100
   */
  runs: [
    {
      id: string;
      name: string;
      state: 'QUEUED' | 'RUNNING' | 'PAUSING' | 'PAUSED' | 'WAITING_INPUT' | 'CANCELLING';
    },
    ...{
      id: string;
      name: string;
      state: 'QUEUED' | 'RUNNING' | 'PAUSING' | 'PAUSED' | 'WAITING_INPUT' | 'CANCELLING';
    }[]
  ];
  /**
   * @maxItems 10
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
    | [string, string, string, string, string, string, string, string, string, string];
}
export interface EntryHandoffRequest {
  version: 1;
  selection: EntryHandoffSelection;
  token: string;
  requestId: string;
  reviewed: true;
}
export interface ConversationContextRef {
  id: string;
  sha256: string;
}
export interface ConversationContext {
  version: 1;
  id: string;
  sha256: string;
  flowId: string;
  nodeId: string;
  title: string;
  provider: 'deepseek' | 'openai-codex';
  model: string;
  instructions: string;
  context: Json;
}
export interface ConversationHistoryCursor {
  sessionId: string;
  before: number;
  sha256: string;
}
export interface ConversationThreadInput {
  provider: 'deepseek' | 'openai-codex';
  model: string;
  instructions: string;
  context: Json;
  /**
   * @minItems 1
   * @maxItems 49
   */
  messages: [
    {
      role: 'user' | 'assistant';
      text: string;
    },
    ...{
      role: 'user' | 'assistant';
      text: string;
    }[]
  ];
}
export interface ConversationThreadPrepared {
  version: 1;
  id: string;
  sessionId: string;
  revision: number;
  historyCount: number;
  historyHash: string;
  context: ConversationContextRef;
  selection: ConversationHistorySelection;
  text: string;
  retryOf: string | null;
  input: ConversationThreadInput;
  sha256: string;
}
export interface ConversationThreadEntry {
  version: 1;
  sessionId: string;
  ordinal: number;
  previousHash: string;
  sha256: string;
  requestId: string;
  turnId: string;
  userMessageId: string;
  assistantMessageId: string;
  text: string;
  answer: string;
  state: 'complete' | 'failed' | 'cancelled';
  model: string;
  providerRequestId: string;
  usage: AIUsage;
  inputId: string;
  inputHash: string;
  context: ConversationContextRef;
  retryOf: string | null;
  error: string;
  finishedAt: string;
}
export interface ConversationThreadActive {
  requestId: string;
  turnId: string;
  userMessageId: string;
  assistantMessageId: string;
  text: string;
  answer: string;
  inputId: string;
  inputHash: string;
  context: ConversationContextRef;
  retryOf: string | null;
}
export interface ConversationThreadSnapshot {
  formatVersion: '2.0';
  id: string;
  flowId: string;
  nodeId: string;
  title: string;
  context: ConversationContextRef;
  origin: ConversationThreadOrigin;
  historyWindow: number;
  revision: number;
  sequence: number;
  status: 'draft' | 'generating' | 'ready' | 'failed' | 'cancelled';
  draft: string;
  requestCount: number;
  turnCount: number;
  historyCount: number;
  historyHash: string;
  active: ConversationThreadActive | null;
  lastEntry: ConversationThreadEntry | null;
  latestCheckpoint: ConversationCheckpointEvidence | null;
  checkpointCurrent: boolean;
  updatedAt: string;
  error: string;
  contextProposalId: string | null;
}
export interface ConversationThreadEvent {
  kind: 'conversation.thread.snapshot';
  eventId: string;
  sessionId: string;
  sequence: number;
  requestId: string | null;
  turnId: string | null;
  snapshot: ConversationThreadSnapshot;
}
export interface ConversationHistoryPage {
  version: 1;
  cursor: ConversationHistoryCursor;
  /**
   * @minItems 0
   * @maxItems 20
   */
  entries:
    | []
    | [ConversationThreadEntry]
    | [ConversationThreadEntry, ConversationThreadEntry]
    | [ConversationThreadEntry, ConversationThreadEntry, ConversationThreadEntry]
    | [ConversationThreadEntry, ConversationThreadEntry, ConversationThreadEntry, ConversationThreadEntry]
    | [
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry
      ]
    | [
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry
      ]
    | [
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry
      ]
    | [
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry
      ]
    | [
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry
      ]
    | [
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry
      ]
    | [
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry
      ]
    | [
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry
      ]
    | [
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry
      ]
    | [
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry
      ]
    | [
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry
      ]
    | [
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry
      ]
    | [
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry
      ]
    | [
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry
      ]
    | [
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry
      ]
    | [
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry,
        ConversationThreadEntry
      ];
  next: ConversationHistoryCursor | null;
}
export interface ConversationContextProposal {
  version: 1;
  id: string;
  sessionId: string;
  revision: number;
  base: ConversationContextRef;
  proposed: ConversationContext;
  historyWindow: number;
  sourceRunId: string;
}
export interface ConversationCheckpoint {
  version: 1;
  id: string;
  sessionId: string;
  title: string;
  sourceRevision: number;
  historyCount: number;
  historyHash: string;
  context: ConversationContext;
  origin: ConversationThreadOrigin;
  selection: ConversationHistorySelection;
  /**
   * @minItems 0
   * @maxItems 48
   */
  transcript: {
    role: 'user' | 'assistant';
    text: string;
    messageId: string;
    requestId: string;
  }[];
  confirmedAt: string;
  sha256: string;
}
export interface ConversationArchiveCapture {
  version: 1;
  sessionId: string;
  title: string;
  revision: number;
  contextRevision: number;
  context: ConversationContextRef;
  origin: ConversationThreadOrigin;
  historyCount: number;
  historyHash: string;
}
export interface ConversationArchiveRecord {
  version: 1;
  archiveId: string;
  ordinal: number;
  previousHash: string;
  sha256: string;
  payload:
    | {
        kind: 'origin';
        snapshot: ConversationSnapshot;
      }
    | {
        kind: 'context';
        context: ConversationContext;
      }
    | {
        kind: 'history';
        entry: ConversationThreadEntry;
      };
}
export interface ConversationArchiveManifest {
  version: 1;
  id: string;
  capture: ConversationArchiveCapture;
  createdAt: string;
  originRequestCount: number;
  historyCount: number;
  contextCount: number;
  recordCount: number;
  requestCount: number;
  completeCount: number;
  failedCount: number;
  cancelledCount: number;
  rootHash: string;
  tailHash: string;
  sha256: string;
}
export interface ConversationArchiveCursor {
  source: ConversationArchiveRef;
  nextOrdinal: number;
  previousHash: string;
}
export interface ConversationArchivePage {
  version: 1;
  cursor: ConversationArchiveCursor;
  /**
   * @minItems 1
   * @maxItems 20
   */
  records:
    | [ConversationArchiveRecord]
    | [ConversationArchiveRecord, ConversationArchiveRecord]
    | [ConversationArchiveRecord, ConversationArchiveRecord, ConversationArchiveRecord]
    | [ConversationArchiveRecord, ConversationArchiveRecord, ConversationArchiveRecord, ConversationArchiveRecord]
    | [
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord
      ]
    | [
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord
      ]
    | [
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord
      ]
    | [
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord
      ]
    | [
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord
      ]
    | [
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord
      ]
    | [
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord
      ]
    | [
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord
      ]
    | [
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord
      ]
    | [
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord
      ]
    | [
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord
      ]
    | [
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord
      ]
    | [
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord
      ]
    | [
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord
      ]
    | [
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord
      ]
    | [
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord,
        ConversationArchiveRecord
      ];
  next: ConversationArchiveCursor | null;
  sha256: string;
}
export interface ConversationSourceCursor {
  version: 1;
  format: 'canonical-record-json-v1';
  source: ConversationArchiveRef;
  recordOrdinal: number;
  byteOffset: number;
  previousHash: string;
}
export interface ConversationSourceChunk {
  version: 1;
  format: 'canonical-record-json-v1';
  source: ConversationArchiveRef;
  recordOrdinal: number;
  recordKind: 'origin' | 'context' | 'history';
  recordHash: string;
  recordBytes: number;
  byteOffset: number;
  byteEnd: number;
  text: string;
  sha256: string;
}
export interface ConversationSourceRead {
  version: 1;
  cursor: ConversationSourceCursor;
  chunk: ConversationSourceChunk;
  next: ConversationSourceCursor | null;
  done: boolean;
}
export interface ConversationSourceManifestOutput {
  version: 1;
  source: ConversationArchiveRef;
  manifest: ConversationArchiveManifest;
  current: boolean;
}
export interface SourceReductionRecipe {
  version: 1;
  provider: 'deepseek' | 'openai-codex';
  model: string;
  instructions: string;
  schema: {
    [k: string]: Json;
  };
  seed: {
    [k: string]: Json;
  };
}
export interface SourceReductionCheckpoint {
  version: 1;
  job: SourceReductionRef;
  revision: number;
  next: null | ConversationSourceCursor;
  accumulator: {
    [k: string]: Json;
  };
  chunks: number;
  records: number;
  bytes: number;
  chainHash: string;
  lastAttemptId: null | string;
  sha256: string;
}
export interface SourceReductionTransport {
  body: string;
  sha256: string;
}
export interface SourceReductionAttempt {
  version: 1;
  attemptId: string;
  job: SourceReductionRef;
  sequence: number;
  checkpointRevision: number;
  checkpointSha256: string;
  runId: string;
  nodeInstance: string;
  configurationRevision: string;
  state: 'prepared' | 'dispatched' | 'response' | 'failed' | 'unknown' | 'committed' | 'abandoned';
  request: AIRequest;
  requestSha256: string;
  transport: null | SourceReductionTransport;
  outcome: null | AIOutcome;
}
export interface SourceReductionOutput {
  version: 1;
  job: SourceReductionRef;
  phase: 'ready' | 'running' | 'attention' | 'complete';
  revision: number;
  checkpoint: SourceReductionCheckpoint;
  pendingAttemptId: null | string;
  attempts: number;
  reportedTotalTokens: number;
  unknownUsageRequests: number;
  proof: null | SourceReductionProof;
}
export interface SourceReductionReviewTarget {
  runId: string;
  nodeId: string;
  nodeInstance: string;
}
export interface SourceReductionReviewSelection {
  version: 1;
  target: SourceReductionReviewTarget;
  jobId: string;
}
export interface SourceReductionReviewCheckpoint {
  revision: number;
  sha256: string;
  next: ConversationSourceCursor | null;
  chunks: number;
  records: number;
  bytes: number;
}
export interface SourceReductionReviewFragment {
  version: 1;
  format: 'canonical-record-json-v1';
  source: ConversationArchiveRef;
  recordOrdinal: number;
  recordKind: 'origin' | 'context' | 'history';
  recordHash: string;
  recordBytes: number;
  byteOffset: number;
  byteEnd: number;
  sha256: string;
}
export interface SourceReductionReviewPending {
  attemptId: string;
  state: 'prepared' | 'response' | 'failed' | 'unknown';
  hasSavedResponse: boolean;
}
export interface SourceReductionRunReview {
  version: 1;
  reviewId: string;
  epoch: string;
  target: SourceReductionReviewTarget;
  mode: 'snapshot';
  executionVersionId: string;
  snapshotSha256: string;
  job: SourceReductionRef;
  jobRevision: number;
  checkpoint: SourceReductionReviewCheckpoint;
  phase: 'ready' | 'attention' | 'complete';
  operation: 'continue-batch' | 'retry-one' | 'use-complete';
  pending: SourceReductionReviewPending | null;
  fragment: SourceReductionReviewFragment | null;
  batchLimit: number;
  requestLimit: number;
  requestScope: 'source-node-instance';
  runStartsAtFirstNode: true;
  provider: 'deepseek' | 'openai-codex';
  model: string;
  configurationRevision: string | null;
  attempts: number;
  reportedTotalTokens: number;
  unknownUsageRequests: number;
  createdAt: string;
  expiresAt: string;
  sha256: string;
}
export interface SourceReductionRunConfirmation {
  version: 1;
  reviewId: string;
  reviewSha256: string;
  requestId: string;
  reviewed: true;
}
export interface SourceReductionRunReviewReceipt {
  version: 1;
  requestId: string;
  runId: string;
  review: SourceReductionRunReview;
  confirmedAt: string;
  sha256: string;
}
export interface SkillUpdateContent {
  title: string;
  markdown: string;
  data: {
    [k: string]: Json;
  };
}
export interface SkillUpdateField {
  id: string;
  target: SkillUpdateTarget;
  baseline: SkillUpdateState;
  current: SkillUpdateState;
  suggested: SkillUpdateState;
  status: 'candidate' | 'conflict' | 'manual-only' | 'already-applied';
}
export interface SkillUpdateReview {
  version: 1;
  reviewId: string;
  proposalId: string;
  revision: number;
  epoch: string;
  baselineSha256: string;
  suggestionSha256: string;
  currentSha256: string;
  sourceSha256: string;
  workspaceRevision: string;
  createdAt: string;
  expiresAt: string;
  /**
   * @maxItems 256
   */
  fields: SkillUpdateField[];
  sha256: string;
  base: SkillVersionRef;
  publishBase: SkillVersionRef;
  bundleSha256: string;
}
export interface SkillUpdateChoice {
  fieldId: string;
  replaceManual: boolean;
}
export interface SkillUpdateSelection {
  proposalId: string;
  revision: number;
}
export interface SkillUpdateApply {
  version: 1;
  proposalId: string;
  revision: number;
  reviewId: string;
  reviewSha256: string;
  requestId: string;
  /**
   * @maxItems 256
   */
  choices: SkillUpdateChoice[];
  reviewed: true;
}
export interface SkillUpdateReceipt {
  version: 1;
  proposalId: string;
  requestId: string;
  confirmationSha256: string;
  reviewSha256: string;
  revisionBefore: number;
  revisionAfter: number;
  contentSha256: string;
  changed: boolean;
}
export interface SkillUpdateOrigin {
  runId: string;
  flowId: string;
  nodeId: string;
  nodeInstance: string;
  executionVersionId: string;
}
export interface SkillUpdateBundle {
  version: 1;
  proposalId: string;
  workspaceBinding: string;
  origin: SkillUpdateOrigin;
  base: SkillVersionRef;
  baseline: SkillUpdateContent;
  /**
   * @maxItems 100
   */
  baselineEvidence: SkillEvidence[];
  suggestion: SkillDraft;
  createdAt: string;
  sha256: string;
}
export interface SkillUpdateInfo {
  version: 1;
  mode: 'field-review';
  proposalId: string;
  revision: number;
  base: SkillVersionRef;
  bundleSha256: string;
  baselineSha256: string;
  suggestionSha256: string;
}
export interface SkillUpdateInput {
  base: SkillVersionRef;
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
export interface SkillUpdateDetail {
  proposal: SkillProposalSnapshot;
  workspace: string;
  application: SkillUpdateApplication | null;
}
export interface BrowserFieldsNode {
  id: string;
  type: 'browser';
  version: 5;
  name?: string;
  timeoutMs?: number;
  operation: 'collect';
  selector:
    | string
    | {
        $ref: string;
      };
  framePath: FramePath;
  /**
   * @minItems 1
   * @maxItems 20
   */
  fields:
    | [BrowserField]
    | [BrowserField, BrowserField]
    | [BrowserField, BrowserField, BrowserField]
    | [BrowserField, BrowserField, BrowserField, BrowserField]
    | [BrowserField, BrowserField, BrowserField, BrowserField, BrowserField]
    | [BrowserField, BrowserField, BrowserField, BrowserField, BrowserField, BrowserField]
    | [BrowserField, BrowserField, BrowserField, BrowserField, BrowserField, BrowserField, BrowserField]
    | [BrowserField, BrowserField, BrowserField, BrowserField, BrowserField, BrowserField, BrowserField, BrowserField]
    | [
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField
      ]
    | [
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField
      ]
    | [
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField
      ]
    | [
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField
      ]
    | [
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField
      ]
    | [
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField
      ]
    | [
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField
      ]
    | [
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField
      ]
    | [
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField
      ]
    | [
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField
      ]
    | [
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField
      ]
    | [
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField,
        BrowserField
      ];
}
export interface BrowserFieldResult {
  key: string;
  selector: string;
  operation: 'text' | 'attribute';
  attribute: string | null;
  required: boolean;
  count: number;
  status: 'ok' | 'missing' | 'ambiguous' | 'missing-attribute' | 'empty';
  value: string | null;
}
export interface BrowserFieldsResult {
  version: 1;
  operation: 'collect';
  url: string;
  documentUrl: string;
  selector: string;
  framePath: FramePath;
  complete: boolean;
  /**
   * @minItems 1
   * @maxItems 20
   */
  fields:
    | [BrowserFieldResult]
    | [BrowserFieldResult, BrowserFieldResult]
    | [BrowserFieldResult, BrowserFieldResult, BrowserFieldResult]
    | [BrowserFieldResult, BrowserFieldResult, BrowserFieldResult, BrowserFieldResult]
    | [BrowserFieldResult, BrowserFieldResult, BrowserFieldResult, BrowserFieldResult, BrowserFieldResult]
    | [
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult
      ]
    | [
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult
      ]
    | [
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult
      ]
    | [
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult
      ]
    | [
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult
      ]
    | [
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult
      ]
    | [
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult
      ]
    | [
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult
      ]
    | [
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult
      ]
    | [
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult
      ]
    | [
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult
      ]
    | [
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult
      ]
    | [
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult
      ]
    | [
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult
      ]
    | [
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult,
        BrowserFieldResult
      ];
}
export interface BrowserRenderedFieldsNode {
  id: string;
  type: 'browser';
  version: 6;
  name?: string;
  timeoutMs?: number;
  operation: 'collect';
  selector:
    | string
    | {
        $ref: string;
      };
  framePath: FramePath;
  /**
   * @minItems 1
   * @maxItems 20
   */
  fields:
    | [BrowserRenderedField]
    | [BrowserRenderedField, BrowserRenderedField]
    | [BrowserRenderedField, BrowserRenderedField, BrowserRenderedField]
    | [BrowserRenderedField, BrowserRenderedField, BrowserRenderedField, BrowserRenderedField]
    | [BrowserRenderedField, BrowserRenderedField, BrowserRenderedField, BrowserRenderedField, BrowserRenderedField]
    | [
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField
      ]
    | [
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField
      ]
    | [
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField
      ]
    | [
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField
      ]
    | [
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField
      ]
    | [
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField
      ]
    | [
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField
      ]
    | [
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField
      ]
    | [
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField
      ]
    | [
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField
      ]
    | [
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField
      ]
    | [
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField
      ]
    | [
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField
      ]
    | [
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField
      ]
    | [
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField,
        BrowserRenderedField
      ];
}
export interface BrowserRenderedFieldResult {
  key: string;
  selector: string;
  operation: 'text' | 'attribute' | 'rendered-text';
  attribute: string | null;
  required: boolean;
  count: number;
  status: 'ok' | 'missing' | 'ambiguous' | 'missing-attribute' | 'empty' | 'hidden' | 'clipped' | 'unsupported';
  value: string | null;
  /**
   * @maxItems 7
   */
  issues:
    | []
    | [
        | 'hidden-target'
        | 'hidden-descendant'
        | 'line-clamp'
        | 'overflow-clip'
        | 'unsupported-layout'
        | 'embedded-content'
        | 'generated-content'
      ]
    | [
        (
          | 'hidden-target'
          | 'hidden-descendant'
          | 'line-clamp'
          | 'overflow-clip'
          | 'unsupported-layout'
          | 'embedded-content'
          | 'generated-content'
        ),
        (
          | 'hidden-target'
          | 'hidden-descendant'
          | 'line-clamp'
          | 'overflow-clip'
          | 'unsupported-layout'
          | 'embedded-content'
          | 'generated-content'
        )
      ]
    | [
        (
          | 'hidden-target'
          | 'hidden-descendant'
          | 'line-clamp'
          | 'overflow-clip'
          | 'unsupported-layout'
          | 'embedded-content'
          | 'generated-content'
        ),
        (
          | 'hidden-target'
          | 'hidden-descendant'
          | 'line-clamp'
          | 'overflow-clip'
          | 'unsupported-layout'
          | 'embedded-content'
          | 'generated-content'
        ),
        (
          | 'hidden-target'
          | 'hidden-descendant'
          | 'line-clamp'
          | 'overflow-clip'
          | 'unsupported-layout'
          | 'embedded-content'
          | 'generated-content'
        )
      ]
    | [
        (
          | 'hidden-target'
          | 'hidden-descendant'
          | 'line-clamp'
          | 'overflow-clip'
          | 'unsupported-layout'
          | 'embedded-content'
          | 'generated-content'
        ),
        (
          | 'hidden-target'
          | 'hidden-descendant'
          | 'line-clamp'
          | 'overflow-clip'
          | 'unsupported-layout'
          | 'embedded-content'
          | 'generated-content'
        ),
        (
          | 'hidden-target'
          | 'hidden-descendant'
          | 'line-clamp'
          | 'overflow-clip'
          | 'unsupported-layout'
          | 'embedded-content'
          | 'generated-content'
        ),
        (
          | 'hidden-target'
          | 'hidden-descendant'
          | 'line-clamp'
          | 'overflow-clip'
          | 'unsupported-layout'
          | 'embedded-content'
          | 'generated-content'
        )
      ]
    | [
        (
          | 'hidden-target'
          | 'hidden-descendant'
          | 'line-clamp'
          | 'overflow-clip'
          | 'unsupported-layout'
          | 'embedded-content'
          | 'generated-content'
        ),
        (
          | 'hidden-target'
          | 'hidden-descendant'
          | 'line-clamp'
          | 'overflow-clip'
          | 'unsupported-layout'
          | 'embedded-content'
          | 'generated-content'
        ),
        (
          | 'hidden-target'
          | 'hidden-descendant'
          | 'line-clamp'
          | 'overflow-clip'
          | 'unsupported-layout'
          | 'embedded-content'
          | 'generated-content'
        ),
        (
          | 'hidden-target'
          | 'hidden-descendant'
          | 'line-clamp'
          | 'overflow-clip'
          | 'unsupported-layout'
          | 'embedded-content'
          | 'generated-content'
        ),
        (
          | 'hidden-target'
          | 'hidden-descendant'
          | 'line-clamp'
          | 'overflow-clip'
          | 'unsupported-layout'
          | 'embedded-content'
          | 'generated-content'
        )
      ]
    | [
        (
          | 'hidden-target'
          | 'hidden-descendant'
          | 'line-clamp'
          | 'overflow-clip'
          | 'unsupported-layout'
          | 'embedded-content'
          | 'generated-content'
        ),
        (
          | 'hidden-target'
          | 'hidden-descendant'
          | 'line-clamp'
          | 'overflow-clip'
          | 'unsupported-layout'
          | 'embedded-content'
          | 'generated-content'
        ),
        (
          | 'hidden-target'
          | 'hidden-descendant'
          | 'line-clamp'
          | 'overflow-clip'
          | 'unsupported-layout'
          | 'embedded-content'
          | 'generated-content'
        ),
        (
          | 'hidden-target'
          | 'hidden-descendant'
          | 'line-clamp'
          | 'overflow-clip'
          | 'unsupported-layout'
          | 'embedded-content'
          | 'generated-content'
        ),
        (
          | 'hidden-target'
          | 'hidden-descendant'
          | 'line-clamp'
          | 'overflow-clip'
          | 'unsupported-layout'
          | 'embedded-content'
          | 'generated-content'
        ),
        (
          | 'hidden-target'
          | 'hidden-descendant'
          | 'line-clamp'
          | 'overflow-clip'
          | 'unsupported-layout'
          | 'embedded-content'
          | 'generated-content'
        )
      ]
    | [
        (
          | 'hidden-target'
          | 'hidden-descendant'
          | 'line-clamp'
          | 'overflow-clip'
          | 'unsupported-layout'
          | 'embedded-content'
          | 'generated-content'
        ),
        (
          | 'hidden-target'
          | 'hidden-descendant'
          | 'line-clamp'
          | 'overflow-clip'
          | 'unsupported-layout'
          | 'embedded-content'
          | 'generated-content'
        ),
        (
          | 'hidden-target'
          | 'hidden-descendant'
          | 'line-clamp'
          | 'overflow-clip'
          | 'unsupported-layout'
          | 'embedded-content'
          | 'generated-content'
        ),
        (
          | 'hidden-target'
          | 'hidden-descendant'
          | 'line-clamp'
          | 'overflow-clip'
          | 'unsupported-layout'
          | 'embedded-content'
          | 'generated-content'
        ),
        (
          | 'hidden-target'
          | 'hidden-descendant'
          | 'line-clamp'
          | 'overflow-clip'
          | 'unsupported-layout'
          | 'embedded-content'
          | 'generated-content'
        ),
        (
          | 'hidden-target'
          | 'hidden-descendant'
          | 'line-clamp'
          | 'overflow-clip'
          | 'unsupported-layout'
          | 'embedded-content'
          | 'generated-content'
        ),
        (
          | 'hidden-target'
          | 'hidden-descendant'
          | 'line-clamp'
          | 'overflow-clip'
          | 'unsupported-layout'
          | 'embedded-content'
          | 'generated-content'
        )
      ];
}
export interface BrowserRenderedFieldsResult {
  version: 2;
  operation: 'collect';
  url: string;
  documentUrl: string;
  selector: string;
  framePath: FramePath;
  complete: boolean;
  /**
   * @minItems 1
   * @maxItems 20
   */
  fields:
    | [BrowserRenderedFieldResult]
    | [BrowserRenderedFieldResult, BrowserRenderedFieldResult]
    | [BrowserRenderedFieldResult, BrowserRenderedFieldResult, BrowserRenderedFieldResult]
    | [BrowserRenderedFieldResult, BrowserRenderedFieldResult, BrowserRenderedFieldResult, BrowserRenderedFieldResult]
    | [
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult
      ]
    | [
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult
      ]
    | [
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult
      ]
    | [
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult
      ]
    | [
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult
      ]
    | [
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult
      ]
    | [
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult
      ]
    | [
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult
      ]
    | [
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult
      ]
    | [
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult
      ]
    | [
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult
      ]
    | [
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult
      ]
    | [
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult
      ]
    | [
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult
      ]
    | [
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult
      ]
    | [
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult,
        BrowserRenderedFieldResult
      ];
  renderPolicy: 'bounded-rendered-text-v1';
}
export interface EffectPrepareNode {
  id: string;
  type: 'effect';
  version: 1;
  name?: string;
  timeoutMs?: number;
  operation: 'prepare';
  action: string;
  key:
    | string
    | {
        $ref: string;
      };
  description?:
    | string
    | {
        $ref: string;
      };
  review?: null | {
    version: 1;
    target:
      | string
      | {
          $ref: string;
        };
    content:
      | string
      | {
          $ref: string;
        };
  };
}
export interface EffectResolveNode {
  id: string;
  type: 'effect';
  version: 1;
  name?: string;
  timeoutMs?: number;
  operation: 'resolve';
  receipt: Value;
  state: 'confirmed' | 'failed' | 'unknown';
  evidence?: Value;
}
export interface EffectResolveResult {
  version: 1;
  operation: 'resolve';
  id: string;
  state: 'confirmed' | 'failed' | 'unknown';
}
