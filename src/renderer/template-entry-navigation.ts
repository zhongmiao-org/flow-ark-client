import type { TemplateSource } from '../shared/template-source';
export type TemplateEntryOrigin = {
  source: TemplateSource;
  flowId: string;
  title: string;
  savedAt: string;
  back: () => void;
};
