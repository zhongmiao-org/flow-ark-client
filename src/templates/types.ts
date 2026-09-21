import type { Bindings } from '../shared/types';
export type TemplateInstance = {
  id: string;
  packageKey: string;
  name: string;
  configuration: any;
  resources: NonNullable<Bindings['resources']>;
  grants: NonNullable<Bindings['grants']>;
  entryFlows: Record<string, string>;
  createdAt: string;
};
