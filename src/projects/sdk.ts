/** Installed script-worker surface. Host validates each request using the installed node/SDK contracts. */
export const scriptSdk = `
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface FlowArkContext {
  readonly input: Json;
  readonly constants: Readonly<Record<string, Json>>;
  readonly signal: AbortSignal;
  logger: { info(value: Json): void };
  progress(completed: number, total?: number): void;
  artifact(name: string, content: string): Promise<Json>;
  template: {
    configuration(): Promise<Json>;
    resource(path: string): Promise<Json>;
    validate(path: string, value: Json): Promise<Json>;
    browser(resourceId: string, command: Json): Promise<Json>;
    file(resourceId: string, request: Json): Promise<Json>;
    ai(resourceId: string, request: Json): Promise<Json>;
    state: { get(): Promise<Json>; set(value: Json): Promise<Json> };
    human(request: Json): Promise<Json>;
    attention(request: Json): Promise<Json>;
    effect: { prepare(request: Json): Promise<Json>; resolve(request: Json): Promise<Json> };
    result(value: Json): Promise<Json>;
  };
}
// export default async function main(ctx: FlowArkContext): Promise<Json> { ... }
// Parameters of browser/file/AI/effect are checked by the installed normative schema.
// Runtime authorization is separate; this declaration grants no resource or effect permissions.
`;
