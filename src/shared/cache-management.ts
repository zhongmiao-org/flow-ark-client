export type CacheCategory =
  | 'temporary'
  | 'log'
  | 'profile'
  | 'test-copy'
  | 'compiled'
  | 'unverified';
export type CacheItem = {
  id: string;
  path: string;
  category: CacheCategory;
  purpose: string;
  status: 'ready' | 'active' | 'unverified' | 'protected' | 'blocked';
  reason: string;
  files: number;
  bytes: number;
  allocatedBytes: number;
};
export type CacheScan = {
  id: string;
  createdAt: string;
  root: string;
  roots: string[];
  items: CacheItem[];
  warnings: string[];
};
export type CachePreview = {
  token: string;
  items: CacheItem[];
  bytes: number;
  files: { path: string; bytes: number; link: boolean }[];
};
export type CacheResult = {
  id: string;
  state: 'pending' | 'completed' | 'interrupted';
  results: {
    id: string;
    path: string;
    status: 'success' | 'failed' | 'skipped';
    reason: string;
    releasedBytes: number;
    availableBytesChange?: number;
  }[];
};
