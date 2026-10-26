import {
  assertReceipt,
  deriveExtension,
  type ExtensionReceipt,
} from '../../contracts/template-resource-extension.mjs';
import { canonical, type Entry, type PackageData } from '../../contracts/package-format';
import { validateObject } from '../core/validate';

// Fixed package objects live for one Run. Never cache live bindings or authority.
const verifiedPackages = new WeakMap<PackageData, Map<string, Promise<void>>>();

export function extensionPackageKey(ref: ExtensionReceipt['basePackage']) {
  return ref.id + '@' + ref.version;
}

export function extensionPackageReference(pkg: PackageData) {
  return {
    id: pkg.manifest.id,
    version: pkg.manifest.version,
    digest: pkg.manifest.contentDigest,
  };
}

export function assertExtensionReceipt(value: ExtensionReceipt) {
  validateObject('TemplateResourceExtensionReceipt', value);
  assertReceipt(value);
}

/** Verify both immutable packages; never attach additions to a synthetic manifest. */
export async function verifyResourceExtension(
  base: PackageData,
  receipt: ExtensionReceipt,
  load: (key: string) => Promise<PackageData>,
) {
  assertExtensionReceipt(receipt);
  if (canonical(extensionPackageReference(base)) !== canonical(receipt.basePackage))
    throw Error('目录声明扩展的原模板来源不匹配');
  let receipts = verifiedPackages.get(base);
  if (!receipts) {
    receipts = new Map();
    verifiedPackages.set(base, receipts);
  }
  const existing = receipts.get(receipt.receiptSha256);
  if (existing) return existing;
  const pending = (async () => {
    const extension = await load(extensionPackageKey(receipt.extensionPackage));
    const compatible = deriveExtension(base, extension);
    if (
      canonical(compatible) !==
      canonical({
        basePackage: receipt.basePackage,
        extensionPackage: receipt.extensionPackage,
        resources: receipt.resources,
        entries: receipt.entries,
      })
    )
      throw Error('目录声明扩展与已登记的标准包不匹配');
  })();
  receipts.set(receipt.receiptSha256, pending);
  void pending.catch(() => {
    if (receipts.get(receipt.receiptSha256) === pending) receipts.delete(receipt.receiptSha256);
  });
  return pending;
}

/** Call only after package verification or while committing its checked receipt. */
export function effectiveResourceDeclarations(
  pkg: PackageData,
  receipt?: ExtensionReceipt,
): PackageData['manifest']['resources'] {
  return [...pkg.manifest.resources, ...(receipt?.resources ?? [])];
}

export function effectiveResourceEntry(entry: Entry, receipt?: ExtensionReceipt): Entry {
  const addition = receipt?.entries.find((item) => item.entryId === entry.id);
  return addition ? { ...entry, resources: [...entry.resources, ...addition.resourceIds] } : entry;
}
