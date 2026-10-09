export type ArtifactPreview = {
  artifactId: string;
  name: string;
  size: number;
} & (
  | { status: 'text'; text: string; truncated: boolean }
  | { status: 'unavailable'; reason: string }
);
