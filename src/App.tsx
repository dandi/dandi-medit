import { useEffect, useCallback, useState, useRef } from 'react';
import { ThemeProvider, createTheme, CssBaseline } from '@mui/material';
import { Box, AppBar, Toolbar, Typography, IconButton, Alert, Snackbar, Tooltip } from '@mui/material';
import InfoIcon from '@mui/icons-material/Info';
import GitHubIcon from '@mui/icons-material/GitHub';
import { MetadataProvider, useMetadataContext } from './context/MetadataContext';
import type { DandiInstance } from './utils/dandiInstances';
import logoIcon from '/logo-white.svg';
import { MainLayout } from './components/Layout/MainLayout';
import { ChatPanel } from './components/Chat/ChatPanel';
import { MetadataPanel } from './components/Metadata/MetadataPanel';
import { WelcomePage } from './components/Welcome/WelcomePage';
import { DandisetIndicator } from './components/Controls/DandisetIndicator';
import { ApiKeyManager } from './components/Controls/ApiKeyManager';
import { InstanceSelector } from './components/Controls/InstanceSelector';
import AboutDialog from './components/About/AboutDialog';
import { fetchDandisetVersionInfo } from './utils/api';
import {
  parseProposalFromUrl,
  validateAndApplyProposal,
  clearProposalFromUrl,
  type ProposalData
} from './core/proposalLink';

// Create a custom theme with better colors for diffs
const theme = createTheme({
  palette: {
    primary: {
      main: '#1976d2',
    },
    success: {
      main: '#2e7d32',
      light: '#4caf50',
      // @ts-expect-error - MUI doesn't have lighter in the type but we can use it
      lighter: '#e8f5e9',
    },
    error: {
      main: '#d32f2f',
      light: '#ef5350',
      // @ts-expect-error - MUI doesn't have lighter in the type but we can use it
      lighter: '#ffebee',
    },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          margin: 0,
          padding: 0,
          height: '100vh',
          overflow: 'hidden',
        },
        '#root': {
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
        },
      },
    },
  },
});

// Parse URL for dandiset ID and review mode
function getUrlParams(): { dandisetId: string | null; isReviewMode: boolean } {
  const params = new URLSearchParams(window.location.search);
  return {
    dandisetId: params.get('dandiset'),
    isReviewMode: params.get('review') === '1',
  };
}

// Update URL with dandiset ID, preserving instance param
function updateUrl(dandisetId: string | null, instance?: DandiInstance) {
  const url = new URL(window.location.href);
  if (dandisetId) {
    url.searchParams.set('dandiset', dandisetId);
  } else {
    url.searchParams.delete('dandiset');
  }
  if (instance) {
    url.searchParams.set('instance', instance.apiUrl);
  }
  // Clean up any old version params
  url.searchParams.delete('version');
  window.history.replaceState({}, '', url.toString());
}

// Update instance in URL without changing other params
function updateInstanceInUrl(instance: DandiInstance) {
  const url = new URL(window.location.href);
  url.searchParams.set('instance', instance.apiUrl);
  window.history.replaceState({}, '', url.toString());
}

// Update URL review param without page reload
function updateReviewParam(isReviewMode: boolean) {
  const url = new URL(window.location.href);
  if (isReviewMode) {
    url.searchParams.set('review', '1');
  } else {
    url.searchParams.delete('review');
  }
  window.history.replaceState({}, '', url.toString());
}

function AppContent() {
  const {
    versionInfo,
    dandisetId,
    setDandisetId,
    setVersion,
    setVersionInfo,
    setIsLoading,
    setError,
    clearModifications,
    apiKey,
    dandiApiBase,
    dandiInstance,
    setOriginalMetadata,
    setModifiedMetadata
  } = useMetadataContext();

  const [aboutDialogOpen, setAboutDialogOpen] = useState(false);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const [isReviewMode, setIsReviewMode] = useState(() => getUrlParams().isReviewMode);

  // Track if we have a pending proposal to apply after metadata loads
  const pendingProposalRef = useRef<ProposalData | null>(null);

  // Keep instance param in URL whenever the selected instance changes
  useEffect(() => {
    updateInstanceInUrl(dandiInstance);
  }, [dandiInstance]);

  // Handler to exit review mode
  const handleExitReviewMode = useCallback(() => {
    setIsReviewMode(false);
    updateReviewParam(false);
  }, []);

  useEffect(() => {
    if (versionInfo && versionInfo.metadata) {
      setOriginalMetadata(versionInfo.metadata);
    }
  }, [versionInfo, setOriginalMetadata]);

  // Apply pending proposal after version info and original metadata are set
  useEffect(() => {
    const applyPendingProposal = async () => {
      console.log('[Proposal] Checking for pending proposal...', {
        hasVersionInfo: !!versionInfo,
        hasMetadata: !!versionInfo?.metadata,
        hasPendingProposal: !!pendingProposalRef.current
      });
      
      if (!versionInfo?.metadata || !pendingProposalRef.current) {
        return;
      }
      
      const proposal = pendingProposalRef.current;
      pendingProposalRef.current = null; // Clear it so we don't re-apply
      
      console.log('[Proposal] Applying proposal...', {
        proposalHash: proposal.h,
        proposalDelta: proposal.d
      });
      
      const result = await validateAndApplyProposal(proposal, versionInfo.metadata);
      
      console.log('[Proposal] Validation result:', result);
      
      if (result.success) {
        // Apply the modified metadata
        console.log('[Proposal] Setting modified metadata:', result.modifiedMetadata);
        setModifiedMetadata(result.modifiedMetadata);
        // Clear proposal from URL
        clearProposalFromUrl();
      } else {
        console.error('[Proposal] Validation failed:', result.error);
        setProposalError(result.error);
        // Clear proposal from URL even on error
        clearProposalFromUrl();
      }
    };
    
    applyPendingProposal();
  }, [versionInfo, setModifiedMetadata]);

  // Load dandiset from URL on initial render
  useEffect(() => {
    const { dandisetId: urlDandisetId } = getUrlParams();
    const proposal = parseProposalFromUrl();
    
    console.log('[Proposal] Initial URL parsing:', {
      urlDandisetId,
      hasProposal: !!proposal,
      proposal: proposal ? { hash: proposal.h, delta: proposal.d } : null
    });
    
    if (urlDandisetId && !versionInfo) {
      // Store proposal to apply after loading
      if (proposal) {
        console.log('[Proposal] Storing proposal for later application');
        pendingProposalRef.current = proposal;
      }
      
      // Auto-load the dandiset from URL parameters (always use draft)
      const loadFromUrl = async () => {
        // Set dandiset ID immediately so main layout shows with loading spinner
        setDandisetId(urlDandisetId);
        setIsLoading(true);
        setError(null);
        try {
          const info = await fetchDandisetVersionInfo(urlDandisetId, 'draft', apiKey, dandiApiBase);
          setVersionInfo(info);
          setVersion('draft');
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to load dandiset from URL');
          // Clear dandiset ID and URL params on error
          setDandisetId('');
          updateUrl(null);
          // Clear pending proposal on error
          pendingProposalRef.current = null;
          clearProposalFromUrl();
        } finally {
          setIsLoading(false);
        }
      };
      loadFromUrl();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run on initial mount

  const handleDandisetLoaded = useCallback((newDandisetId: string) => {
    updateUrl(newDandisetId, dandiInstance);
  }, [dandiInstance]);

  const handleChangeDandiset = useCallback(() => {
    setVersionInfo(null);
    setDandisetId('');
    setVersion('draft');
    clearModifications();
    updateUrl(null);
  }, [setVersionInfo, setDandisetId, setVersion, clearModifications]);

  // Show welcome page if no dandiset is loaded
  const showWelcome = !versionInfo && !dandisetId;

  if (showWelcome) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100%', overflow: 'hidden' }}>
        {/* Minimal App Bar for welcome page */}
        <AppBar position="static" elevation={1}>
          <Toolbar variant="dense" sx={{ minHeight: { xs: 48, sm: 48 }, px: { xs: 1, sm: 2 } }}>
            <Box component="img" src={logoIcon} alt="Logo" sx={{ height: 24, mr: { xs: 0.5, sm: 1 } }} />
            <Typography
              variant="h6"
              component="div"
              sx={{
                flexGrow: 1,
                fontSize: { xs: '0.9rem', sm: '1.25rem' },
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                mr: { xs: 0.5, sm: 2 },
                display: { xs: 'none', sm: 'block' }
              }}
            >
              Dandiset Metadata Assistant
            </Typography>
            <Box sx={{ flexGrow: { xs: 1, sm: 0 } }} />
            <IconButton
              color="inherit"
              onClick={() => setAboutDialogOpen(true)}
              size="small"
              sx={{ mr: { xs: 0.5, sm: 1 }, flexShrink: 0 }}
            >
              <InfoIcon />
            </IconButton>
              <Box sx={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 1 }}>
              <InstanceSelector />
              <IconButton
                color="inherit"
                component="a"
                href="https://github.com/dandi/dandi-medit"
                target="_blank"
                rel="noopener noreferrer"
                size="small"
                sx={{ mr: 1 }}
              >
                <GitHubIcon />
              </IconButton>
              <ApiKeyManager />
            </Box>
          </Toolbar>
        </AppBar>

        {/* Welcome Page */}
        <Box sx={{ flex: 1, overflow: 'hidden' }}>
          <WelcomePage onDandisetLoaded={handleDandisetLoaded} />
        </Box>

        {/* About Dialog */}
        <AboutDialog
          open={aboutDialogOpen}
          onClose={() => setAboutDialogOpen(false)}
        />
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100%', overflow: 'hidden' }}>
      {/* App Bar with loaded dandiset */}
      <AppBar position="static" elevation={1}>
        <Toolbar variant="dense" sx={{ minHeight: { xs: 48, sm: 48 }, px: { xs: 1, sm: 2 } }}>
          <Tooltip title="Go to welcome screen">
            <IconButton
              color="inherit"
              onClick={handleChangeDandiset}
              size="small"
              sx={{
                mr: { xs: 0.5, sm: 1 },
                flexShrink: 0,
                display: { xs: 'inline-flex', sm: 'none' }
              }}
            >
              <Box component="img" src={logoIcon} alt="Logo" sx={{ height: 20 }} />
            </IconButton>
          </Tooltip>
          <Box component="img" src={logoIcon} alt="Logo" sx={{ height: 24, mr: { xs: 0.5, sm: 1 }, display: { xs: 'none', sm: 'block' } }} />
          <Typography
            variant="h6"
            component="div"
            sx={{
              mr: { xs: 1, sm: 3 },
              cursor: 'pointer',
              fontSize: { xs: '0.9rem', sm: '1.25rem' },
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              flexShrink: 1,
              minWidth: 0,
              display: { xs: 'none', sm: 'block' },
              '&:hover': {
                opacity: 0.8,
              }
            }}
            onClick={handleChangeDandiset}
          >
            Dandiset Metadata Assistant
          </Typography>
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <DandisetIndicator onChangeDandiset={handleChangeDandiset} />
          </Box>
          <IconButton
            color="inherit"
            onClick={() => setAboutDialogOpen(true)}
            size="small"
            sx={{ mr: { xs: 0.5, sm: 1 }, flexShrink: 0 }}
          >
            <InfoIcon />
          </IconButton>
          <Box sx={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 1 }}>
            <InstanceSelector locked />
            <IconButton
              color="inherit"
              component="a"
              href="https://github.com/dandi/dandi-medit"
              target="_blank"
              rel="noopener noreferrer"
              size="small"
              sx={{ mr: 1 }}
            >
              <GitHubIcon />
            </IconButton>
            <ApiKeyManager />
          </Box>
        </Toolbar>
      </AppBar>

      {/* Main Content */}
      <Box sx={{ flex: 1, overflow: 'hidden' }}>
        {isReviewMode ? (
          <MetadataPanel isReviewMode={true} onExitReviewMode={handleExitReviewMode} />
        ) : (
          <MainLayout
            leftPanel={<ChatPanel />}
            rightPanel={<MetadataPanel />}
            initialLeftWidth={50}
            minLeftWidth={25}
            maxLeftWidth={75}
          />
        )}
      </Box>

      {/* About Dialog */}
      <AboutDialog
        open={aboutDialogOpen}
        onClose={() => setAboutDialogOpen(false)}
      />

      {/* Proposal Error Snackbar */}
      <Snackbar
        open={!!proposalError}
        autoHideDuration={15000}
        onClose={() => setProposalError(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setProposalError(null)}
          severity="error"
          variant="filled"
          sx={{ width: '100%' }}
        >
          {proposalError}
        </Alert>
      </Snackbar>
    </Box>
  );
}

function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <MetadataProvider>
        <AppContent />
      </MetadataProvider>
    </ThemeProvider>
  );
}

export default App;
