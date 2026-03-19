export interface DandiInstance {
  name: string;
  apiUrl: string;
  webUrl: string;
}

export const DANDI_INSTANCES: DandiInstance[] = [
  {
    name: 'DANDI Production',
    apiUrl: 'https://api.dandiarchive.org/api',
    webUrl: 'https://dandiarchive.org',
  },
  {
    name: 'DANDI Sandbox',
    apiUrl: 'https://api.sandbox.dandiarchive.org/api',
    webUrl: 'https://sandbox.dandiarchive.org',
  },
  {
    name: 'EMBER',
    apiUrl: 'https://api-dandi.emberarchive.org/api',
    webUrl: 'https://dandi.emberarchive.org',
  },
  {
    name: 'EMBER Sandbox',
    apiUrl: 'https://api-dandi.sandbox.emberarchive.org/api',
    webUrl: 'https://dandi.sandbox.emberarchive.org',
  },
];

export const DEFAULT_INSTANCE = DANDI_INSTANCES[0];

const SELECTED_INSTANCE_KEY = 'dandi-selected-instance-url';

function normalizeApiUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

export function getInstanceByApiUrl(apiUrl: string): DandiInstance | undefined {
  const normalized = normalizeApiUrl(apiUrl);
  return DANDI_INSTANCES.find((i) => normalizeApiUrl(i.apiUrl) === normalized);
}

export function getStoredInstance(): DandiInstance {
  try {
    const storedUrl = localStorage.getItem(SELECTED_INSTANCE_KEY);
    if (storedUrl) {
      const found = DANDI_INSTANCES.find((i) => i.apiUrl === storedUrl);
      if (found) return found;
    }
  } catch {
    // ignore
  }
  return DEFAULT_INSTANCE;
}

export interface InitialInstanceResult {
  instance: DandiInstance;
  urlInstanceParam: string | null;
  urlInstanceError: string | null;
}

export function getInitialInstanceWithStatus(): InitialInstanceResult {
  try {
    const params = new URLSearchParams(window.location.search);
    const instanceUrl = params.get('instance');
    if (instanceUrl) {
      const found = getInstanceByApiUrl(instanceUrl);
      if (found) {
        return { instance: found, urlInstanceParam: instanceUrl, urlInstanceError: null };
      }
      // URL has an instance param that doesn't match any known instance
      const knownNames = DANDI_INSTANCES.map((i) => `${i.name} (${i.apiUrl})`).join(', ');
      return {
        instance: getStoredInstance(),
        urlInstanceParam: instanceUrl,
        urlInstanceError: `The API instance "${instanceUrl}" from the URL is not recognized. Known instances: ${knownNames}`,
      };
    }
  } catch {
    // ignore
  }
  return { instance: getStoredInstance(), urlInstanceParam: null, urlInstanceError: null };
}

export function getInitialInstance(): DandiInstance {
  return getInitialInstanceWithStatus().instance;
}

export function setStoredInstance(instance: DandiInstance): void {
  try {
    localStorage.setItem(SELECTED_INSTANCE_KEY, instance.apiUrl);
  } catch {
    // ignore
  }
}
