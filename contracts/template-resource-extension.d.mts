/** JSON Schema is authoritative; these are pure reference helper types. */
export type ExtensionPackage = { id: string; version: string; digest: string };
export type ExtensionDirectory = { id: string; name: string; kind: 'directory'; access: 'write' | 'readwrite'; required: boolean };
export type ExtensionEntryAddition = { entryId: string; resourceIds: string[] };
export type ExtensionApplyRequest = { version: 1; requestId: string; instanceId: string; expectedRevision: string; basePackage: ExtensionPackage; extensionPackage: ExtensionPackage };
export type ExtensionReceipt = { version: 1; requestId: string; requestSha256: string; instanceId: string; previousRevision: string; basePackage: ExtensionPackage; extensionPackage: ExtensionPackage; resources: ExtensionDirectory[]; entries: ExtensionEntryAddition[]; appliedAt: string; receiptSha256: string };
export type CompatibleExtension = Pick<ExtensionReceipt, 'basePackage' | 'extensionPackage' | 'resources' | 'entries'>;
export type PackageEvidence = { manifest: any; files: Map<string, Uint8Array> };
export function canonical(value: unknown): string;
export function digest(value: unknown): string;
export function deriveExtension(base: PackageEvidence, extension: PackageEvidence): CompatibleExtension;
export function requestFromReceipt(receipt: ExtensionReceipt): ExtensionApplyRequest;
export function assertReceipt(receipt: ExtensionReceipt): void;
export function receiptValue(request: ExtensionApplyRequest, compatible: CompatibleExtension, appliedAt: string): ExtensionReceipt;
export function assertFixedReceipt(fixed: ExtensionReceipt, live: ExtensionReceipt, instanceId: string, entryId: string): void;
