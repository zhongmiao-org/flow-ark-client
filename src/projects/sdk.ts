import { desktopTableRangeTypes } from './desktop-table-range.generated';
import { desktopSdkTypes } from './desktop-sdk.generated';
/** Installed script-worker surface. Host validates each request using the installed node/SDK contracts. */
export const scriptSdk = `${desktopSdkTypes}
${desktopTableRangeTypes}

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface FlowArkContext {
  readonly input: Json;
  readonly constants: Readonly<Record<string, Json>>;
  readonly signal: AbortSignal;
  desktop: {
    /** Uses the caller-prepared effect. Activates and selects the bounded rectangle, then locally parses TSV.
     * Exact target and window size are checked before every step. Shape, requireBlank and expected mismatch throw.
     * No model calls, paste, save, effect prepare/resolve or automatic retries. Cells stay local. */
    readTableRange(request: DesktopTableRangeRequest): Promise<DesktopTableRangeResult>;
    readSelection(request: {observationId: string}): Promise<DesktopSelectionResult>;
    decide(request: {observationId: string; instructions: string; input?: Record<string,Json>; schema: Json; useScreenshot?: boolean}): Promise<{output: Json; requestId: string; model: string; provider: string; usage?: Json}>;
    observe(options?: {screenshot?: boolean}): Promise<DesktopObservation>;
    act(request: {effectId: string; observationId: string; effectKey: string; command: DesktopCommand}): Promise<DesktopActionReceipt>;
  };
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
    effect: { prepare(request: EffectPrepareInput): Promise<EffectPrepareResult>; resolve(request: EffectResolveInput): Promise<boolean> };
    result(value: Json): Promise<Json>;
  };
}
type InstalledFlowArkContext = FlowArkContext;
declare global { interface FlowArkContext extends InstalledFlowArkContext {} }
// export default async function main(ctx: FlowArkContext): Promise<Json> { ... }
// Parameters of browser/file/AI/effect are checked by the installed normative schema.
// Runtime authorization is separate; this declaration grants no resource or effect permissions.
`;
