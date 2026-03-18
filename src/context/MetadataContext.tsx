/* eslint-disable @typescript-eslint/no-explicit-any */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { ModifyMetadataResult } from '../chat/types';
import {
  applyOperation,
  getValueAtPath,
  normalizePath,
  type MetadataOperationType
} from '../core/metadataOperations';
import { formatValidationErrors, validateFullMetadata } from '../schemas/validateMetadata';
import type { DandisetMetadata, DandisetVersionInfo } from '../types/dandiset';
import {
  getStoredDandiApiKey,
  setStoredDandiApiKey,
  clearStoredDandiApiKey,
  type StorageType
} from '../utils/dandiApiKeyStorage';
import {
  type DandiInstance,
  getInitialInstanceWithStatus,
  setStoredInstance,
} from '../utils/dandiInstances';

interface MetadataContextType {
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

const MetadataContext = createContext<MetadataContextType | undefined>(undefined);

export function MetadataProvider({ children }: { children: ReactNode }) {
  const [dandisetId, setDandisetId] = useState<string>('');
  const [version, setVersion] = useState<string>('draft');
  const [versionInfo, setVersionInfo] = useState<DandisetVersionInfo | null>(null);
  const [originalMetadata, setOriginalMetadata] = useState<DandisetMetadata | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [initialInstanceStatus] = useState(() => {
    const status = getInitialInstanceWithStatus();
    // If the URL specified a valid instance, persist it as the selected instance
    if (status.urlInstanceParam && !status.urlInstanceError) {
      setStoredInstance(status.instance);
    }
    return status;
  });
  const [dandiInstance, setDandiInstanceState] = useState<DandiInstance>(() => initialInstanceStatus.instance);

  const [apiKey, setApiKeyState] = useState<string | null>(() => {
    return getStoredDandiApiKey(initialInstanceStatus.instance.apiUrl);
  });

  // Ref to track pending metadata for synchronous validation
  // This allows multiple sequential modifyMetadata calls to build on each other correctly
  const modifiedMetadataRef = useRef<DandisetMetadata | null>(null);

  const [modifiedMetadata, setModifiedMetadata] = useState<DandisetMetadata | null>(null);
  const [metadataRefreshCode, setMetadataRefreshCode] = useState<number>(0);
  useEffect(() => {
    setModifiedMetadata(modifiedMetadataRef.current);
  }, [metadataRefreshCode]);

  const setApiKey = useCallback((key: string | null, storageType: StorageType = 'session') => {
    if (key) {
      setStoredDandiApiKey(key, storageType, dandiInstance.apiUrl);
    } else {
      clearStoredDandiApiKey(dandiInstance.apiUrl);
    }
    setApiKeyState(key);
  }, [dandiInstance.apiUrl]);

  const setDandiInstance = useCallback((instance: DandiInstance) => {
    setStoredInstance(instance);
    setDandiInstanceState(instance);
    // Load API key for the new instance (clear if none stored)
    const newApiKey = getStoredDandiApiKey(instance.apiUrl);
    setApiKeyState(newApiKey);
  }, []);

  const modifyMetadata = useCallback((operation: MetadataOperationType, path: string, value?: unknown): ModifyMetadataResult => {
    const currentMetadata = modifiedMetadataRef.current || originalMetadata;

    if (currentMetadata === null) {
      return { success: false, error: 'No metadata loaded' };
    }

    const normalizedPath = normalizePath(path);
    const result = applyOperation(currentMetadata, operation, normalizedPath, value);

    if (!result.success) {
      return { success: false, error: result.error };
    }

    const newMetadata = result.data as DandisetMetadata;

    // Only validate if the current metadata (before this change) was valid
    // If it's already invalid, allow changes without validation
    const currentIsValid = validateFullMetadata(currentMetadata).valid;

    if (currentIsValid) {
      // Validate against schema
      const validationResult = validateFullMetadata(newMetadata);
      if (!validationResult.valid) {
        // Skip validation if schema is not loaded (indicated by schema-loading keyword)
        const isSchemaNotLoaded = validationResult.errors.some(e => e.keyword === 'schema-loading');
        if (!isSchemaNotLoaded) {
          return {
            success: false,
            error: formatValidationErrors(validationResult.errors).join('\n')
          };
        }
        // Schema not loaded yet, allow the change (validation will happen on commit)
      }
    }

    modifiedMetadataRef.current = newMetadata;
    setMetadataRefreshCode((code) => code + 1);

    return { success: true };
  }, [originalMetadata]);

  const clearModifications = useCallback(() => {
    modifiedMetadataRef.current = originalMetadata;
    setMetadataRefreshCode((code) => code + 1);
  }, [originalMetadata]);

  const revertField = useCallback((fieldKey: string) => {
    const currentMetadata = modifiedMetadataRef.current || originalMetadata;
    if (!originalMetadata || !currentMetadata) return;

    const originalValue = getValueAtPath(originalMetadata, fieldKey);
    const result = applyOperation(currentMetadata, 'set', fieldKey, originalValue);

    if (result.success) {
      const newMetadata = result.data as DandisetMetadata;
      modifiedMetadataRef.current = newMetadata;
      setMetadataRefreshCode((code) => code + 1);
    }
  }, [originalMetadata]);

  const setOriginalMetadata1 = useCallback((metadata: DandisetMetadata | null) => {
    setOriginalMetadata(metadata);
    modifiedMetadataRef.current = null; // Reset modifications when loading new metadata
    setMetadataRefreshCode((code) => code + 1);
  }, []);

  const setModifiedMetadata1 = useCallback((metadata: DandisetMetadata | null) => {
    modifiedMetadataRef.current = metadata;
    setMetadataRefreshCode((code) => code + 1);
  }, []);

  const value: MetadataContextType = {
    dandisetId,
    setDandisetId,
    version,
    setVersion,
    versionInfo,
    setVersionInfo,
    isLoading,
    setIsLoading,
    error,
    setError,
    modifyMetadata,
    revertField,
    apiKey,
    setApiKey,
    dandiInstance,
    setDandiInstance,
    dandiApiBase: dandiInstance.apiUrl,
    urlInstanceError: initialInstanceStatus.urlInstanceError,
    originalMetadata,
    modifiedMetadata: modifiedMetadata || originalMetadata,
    setOriginalMetadata: setOriginalMetadata1,
    setModifiedMetadata: setModifiedMetadata1,
    clearModifications
  };

  return (
    <MetadataContext.Provider value={value}>
      {children}
    </MetadataContext.Provider>
  );
}

export function useMetadataContext() {
  const context = useContext(MetadataContext);
  if (context === undefined) {
    throw new Error('useMetadataContext must be used within a MetadataProvider');
  }
  return context;
}
