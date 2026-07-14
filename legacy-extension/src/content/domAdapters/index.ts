import type { SiteAdapter } from '../../types';
import { chatgptAdapter } from './chatgptAdapter';
import { claudeAdapter } from './claudeAdapter';

const ADAPTERS: SiteAdapter[] = [chatgptAdapter, claudeAdapter];

export function getAdapterForHost(hostname: string): SiteAdapter | null {
  return ADAPTERS.find((adapter) => adapter.matchesHost(hostname)) ?? null;
}

export { chatgptAdapter, claudeAdapter };
