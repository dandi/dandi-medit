import type { DandisetVersionInfo } from '../types/dandiset';
import { DEFAULT_INSTANCE } from './dandiInstances';

export interface OwnedDandiset {
  identifier: string;
  created: string;
  modified: string;
  embargo_status: string;
  draft_version: {
    version: string;
    name: string;
    asset_count: number;
    size: number;
    status: string;
    modified: string;
  };
}

export type DandisetSortOrder = 'modified' | '-modified' | 'id' | '-id';

export interface DandisetsPage {
  results: OwnedDandiset[];
  count: number;
}

export async function fetchDandisets(options: {
  apiKey?: string | null;
  onlyMine?: boolean;
  hideEmpty?: boolean;
  order?: DandisetSortOrder;
  page?: number;
  pageSize?: number;
  dandiApiBase: string;
}): Promise<DandisetsPage> {
  const { apiKey, onlyMine = false, hideEmpty = false, order = '-modified', page = 1, pageSize = 25, dandiApiBase } = options;
  const params = new URLSearchParams({
    order,
    page: String(page),
    page_size: String(pageSize),
  });
  if (onlyMine) {
    params.set('user', 'me');
    params.set('embargoed', 'true');
  }
  if (hideEmpty) {
    params.set('empty', 'false');
  }

  const headers: HeadersInit = {};
  if (apiKey) {
    headers['Authorization'] = `token ${apiKey}`;
  }

  const response = await fetch(`${dandiApiBase}/dandisets/?${params}`, { headers });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Invalid API key');
    }
    throw new Error(`Failed to fetch dandisets: ${response.statusText}`);
  }

  const data = await response.json();
  return { results: data.results as OwnedDandiset[], count: data.count as number };
}

export async function fetchDandisetVersionInfo(
  dandisetId: string,
  version: string,
  apiKey?: string | null,
  dandiApiBase?: string
): Promise<DandisetVersionInfo> {
  const base = dandiApiBase || DEFAULT_INSTANCE.apiUrl;
  const url = `${base}/dandisets/${dandisetId}/versions/${version}/info/`;

  const headers: HeadersInit = {};
  if (apiKey) {
    headers['Authorization'] = `token ${apiKey}`;
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Dandiset ${dandisetId} version ${version} not found`);
    }
    throw new Error(`Failed to fetch dandiset info: ${response.statusText}`);
  }

  const data = await response.json();
  return data as DandisetVersionInfo;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function commitMetadataChanges(
  dandisetId: string,
  version: string,
  metadata: any,
  apiKey: string,
  dandiApiBase?: string
): Promise<void> {
  const base = dandiApiBase || DEFAULT_INSTANCE.apiUrl;
  const url = `${base}/dandisets/${dandisetId}/versions/${version}/`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `token ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      metadata,
      name: metadata.name,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));

    if (response.status === 401 || response.status === 403) {
      throw new Error('Authentication failed. Please check your API key.');
    }

    throw new Error(
      errorData.detail ||
      errorData.message ||
      `Failed to commit metadata: ${response.statusText}`
    );
  }

  console.log('Metadata committed successfully');
}

export interface DandiUser {
  username: string;
  name: string;
  admin: boolean;
  status: string;
}

export async function verifyApiKey(apiKey: string, dandiApiBase: string): Promise<void> {
  const url = `${dandiApiBase}/users/search/?search=testing`;
  const response = await fetch(url, {
    headers: {
      Authorization: `token ${apiKey}`,
    },
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('Invalid API key');
    }
    throw new Error(`Authentication check failed: ${response.statusText}`);
  }
}

export interface DandisetOwner {
  username: string;
}

export async function fetchCurrentUser(apiKey: string, dandiApiBase: string): Promise<DandiUser> {
  const url = `${dandiApiBase}/users/me/`;

  const response = await fetch(url, {
    headers: {
      Authorization: `token ${apiKey}`,
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Invalid API key');
    }
    throw new Error(`Failed to fetch current user: ${response.statusText}`);
  }

  const data = await response.json();
  return data as DandiUser;
}

export async function fetchDandisetOwners(
  dandisetId: string,
  apiKey: string,
  dandiApiBase: string
): Promise<DandisetOwner[]> {
  const url = `${dandiApiBase}/dandisets/${dandisetId}/users/`;

  const response = await fetch(url, {
    headers: {
      Authorization: `token ${apiKey}`,
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Invalid API key');
    }
    if (response.status === 404) {
      throw new Error(`Dandiset ${dandisetId} not found`);
    }
    throw new Error(`Failed to fetch dandiset owners: ${response.statusText}`);
  }

  const data = await response.json();
  return data as DandisetOwner[];
}

export async function checkUserIsOwner(
  dandisetId: string,
  apiKey: string,
  dandiApiBase: string
): Promise<boolean> {
  try {
    const [currentUser, owners] = await Promise.all([
      fetchCurrentUser(apiKey, dandiApiBase),
      fetchDandisetOwners(dandisetId, apiKey, dandiApiBase),
    ]);

    return owners.some((owner) => owner.username === currentUser.username);
  } catch (error) {
    console.error('Failed to check ownership:', error);
    return false;
  }
}
