import { Box, Typography, Button } from '@mui/material';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import { useMetadataContext } from '../../context/useMetadataContext';

interface DandisetIndicatorProps {
  onChangeDandiset: () => void;
}

export function DandisetIndicator({ onChangeDandiset }: DandisetIndicatorProps) {
  const { dandisetId } = useMetadataContext();

  if (!dandisetId) {
    return null;
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 0.5, sm: 1 }, minWidth: 0 }}>
      <FolderOpenIcon sx={{ fontSize: 20, opacity: 0.8, flexShrink: 0, display: { xs: 'none', sm: 'block' } }} />
      <Typography
        variant="body1"
        sx={{
          fontWeight: 500,
          userSelect: 'none',
          fontSize: { xs: '0.85rem', sm: '1rem' },
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          minWidth: 0
        }}
      >
        {dandisetId}
      </Typography>
      <Button
        size="small"
        onClick={onChangeDandiset}
        startIcon={<SwapHorizIcon sx={{ display: { xs: 'none', sm: 'inline-block' } }} />}
        sx={{
          color: 'inherit',
          ml: { xs: 0.5, sm: 1 },
          textTransform: 'none',
          fontSize: { xs: '0.7rem', sm: '0.8rem' },
          minWidth: 'auto',
          px: { xs: 1, sm: 1.5 },
          flexShrink: 0,
          display: { xs: 'none', sm: 'inline-flex' },
          '&:hover': {
            backgroundColor: 'rgba(255, 255, 255, 0.1)',
          },
        }}
      >
        Change
      </Button>
    </Box>
  );
}
