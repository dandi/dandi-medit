import { createContext, useContext } from 'react';
import type { ModifyMetadataResult } from '../chat/types';
import type { MetadataOperationType } from '../core/metadataOperations';
import type { DandisetMetadata, DandisetVersionInfo } from '../types/dandiset';
import type { StorageType } from '../utils/dandiApiKeyStorage';
import type { DandiInstance } from '../utils/dandiInstances';

export interface MetadataContextType {
  // Current dandiset info
  dandisetId: string;
  setDandisetId: (id: string) => void;
  version: string;
  setVersion: (version: string) => void;

  // Loaded data
  versionInfo: DandisetVersionInfo | null;
  setVersionInfo: (info: DandisetVersionInfo | null) => void;

  // Loading state
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
  error: string | null;
  setError: (error: string | null) => void;

  // API Key
  apiKey: string | null;
  setApiKey: (key: string | null, storageType?: StorageType) => void;

  // DANDI instance
  dandiInstance: DandiInstance;
  setDandiInstance: (instance: DandiInstance) => void;
  dandiApiBase: string;

  // URL instance mismatch info (set once on init)
  urlInstanceError: string | null;

  // Get the current metadata with pending changes applied
  originalMetadata: DandisetMetadata | null;
  modifiedMetadata: DandisetMetadata | null;
  setOriginalMetadata: (metadata: DandisetMetadata | null) => void;
  setModifiedMetadata: (metadata: DandisetMetadata | null) => void;

  clearModifications: () => void;

  // Metadata modification functions
  modifyMetadata: (operation: MetadataOperationType, path: string, value?: unknown) => ModifyMetadataResult;
  revertField: (fieldKey: string) => void;
}

export const MetadataContext = createContext<MetadataContextType | undefined>(undefined);

export function useMetadataContext() {
  const context = useContext(MetadataContext);
  if (context === undefined) {
    throw new Error('useMetadataContext must be used within a MetadataProvider');
  }
  return context;
}
