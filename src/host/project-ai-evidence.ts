import { digest } from '../shared/utils';

/** Approval identity only. Never copy image bytes or private paths into history. */
export function projectAIEvidenceStamp(evidence: any): string {
  const window = evidence?.window;
  return digest({
    workbook: evidence?.workbook
      ? {
          path: evidence.selectedFile ?? null,
          sha256: evidence.workbook.sha256 ?? null,
        }
      : null,
    window: window
      ? {
          capturedAt: window.capturedAt ?? null,
          bindingId: window.bindingId ?? null,
          observationSha256: digest(window.observation ?? null),
          screenshot: window.image
            ? {
                sha256: digest(window.image.data),
                mimeType: window.image.mimeType,
                width: window.image.width,
                height: window.image.height,
              }
            : null,
        }
      : null,
  });
}
