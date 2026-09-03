import { useState } from 'react';
import {
  Box,
  Typography,
  Collapse,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableRow,
  Link,
  Chip,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import LockIcon from '@mui/icons-material/Lock';
import { useMetadataContext } from '../../context/useMetadataContext';

function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return '—';
  try {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateString;
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

interface ReadOnlyFieldProps {
  label: string;
  value: React.ReactNode;
}

function ReadOnlyField({ label, value }: ReadOnlyFieldProps) {
  return (
    <TableRow>
      <TableCell 
        sx={{ 
          width: 140, 
          fontWeight: 500, 
          color: 'text.secondary',
          py: 0.5,
          border: 0,
          verticalAlign: 'top',
        }}
      >
        {label}
      </TableCell>
      <TableCell sx={{ py: 0.5, border: 0 }}>
        {value}
      </TableCell>
    </TableRow>
  );
}

export function ReadOnlySection() {
  const [expanded, setExpanded] = useState(false);
  const { versionInfo } = useMetadataContext();

  if (!versionInfo) return null;

  const metadata = versionInfo.metadata;

  return (
    <Box 
      sx={{ 
        backgroundColor: 'grey.50', 
        borderRadius: 1, 
        border: '1px solid',
        borderColor: 'grey.200',
      }}
    >
      {/* Header */}
      <Box 
        sx={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between',
          px: 2,
          py: 1,
          cursor: 'pointer',
          '&:hover': { backgroundColor: 'grey.100' },
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <LockIcon fontSize="small" sx={{ color: 'text.secondary' }} />
          <Typography variant="body2" color="text.secondary" fontWeight={500}>
            Read-only Fields
          </Typography>
          <Chip 
            label="Auto-generated" 
            size="small" 
            sx={{ height: 18, fontSize: '0.65rem', backgroundColor: 'grey.200' }} 
          />
        </Box>
        <IconButton size="small" sx={{ p: 0.25 }}>
          {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
        </IconButton>
      </Box>

      {/* Content */}
      <Collapse in={expanded}>
        <Box sx={{ px: 2, pb: 2 }}>
          <Table size="small">
            <TableBody>
              <ReadOnlyField 
                label="ID" 
                value={
                  <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                    {metadata.id}
                  </Typography>
                }
              />
              <ReadOnlyField 
                label="Identifier" 
                value={
                  <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                    {metadata.identifier}
                  </Typography>
                }
              />
              <ReadOnlyField 
                label="URL" 
                value={
                  metadata.url ? (
                    <Link href={metadata.url} target="_blank" rel="noopener noreferrer" sx={{ fontSize: '0.85rem' }}>
                      {metadata.url}
                    </Link>
                  ) : '—'
                }
              />
              <ReadOnlyField 
                label="Repository" 
                value={
                  metadata.repository ? (
                    <Link href={metadata.repository} target="_blank" rel="noopener noreferrer" sx={{ fontSize: '0.85rem' }}>
                      {metadata.repository}
                    </Link>
                  ) : '—'
                }
              />
              <ReadOnlyField 
                label="Version" 
                value={<Typography variant="body2">{metadata.version}</Typography>}
              />
              <ReadOnlyField 
                label="Schema Version" 
                value={<Typography variant="body2">{metadata.schemaVersion}</Typography>}
              />
              <ReadOnlyField 
                label="Date Created" 
                value={<Typography variant="body2">{formatDate(metadata.dateCreated)}</Typography>}
              />
              <ReadOnlyField 
                label="Citation" 
                value={
                  <Typography variant="body2" sx={{ fontSize: '0.8rem', fontStyle: 'italic' }}>
                    {metadata.citation || '—'}
                  </Typography>
                }
              />
              
              {/* Access */}
              {metadata.access && metadata.access.length > 0 && (
                <ReadOnlyField 
                  label="Access" 
                  value={
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                      {metadata.access.map((a, i) => (
                        <Chip 
                          key={i} 
                          label={a.status.replace('dandi:', '')} 
                          size="small"
                          color={a.status === 'dandi:OpenAccess' ? 'success' : 'warning'}
                          sx={{ height: 20, fontSize: '0.7rem' }}
                        />
                      ))}
                    </Box>
                  }
                />
              )}

              {/* Assets Summary */}
              {metadata.assetsSummary && (
                <>
                  <ReadOnlyField 
                    label="Files" 
                    value={
                      <Typography variant="body2">
                        {metadata.assetsSummary.numberOfFiles?.toLocaleString() || 0} files
                      </Typography>
                    }
                  />
                  <ReadOnlyField 
                    label="Size" 
                    value={
                      <Typography variant="body2">
                        {formatBytes(metadata.assetsSummary.numberOfBytes || 0)}
                      </Typography>
                    }
                  />
                  {metadata.assetsSummary.species && metadata.assetsSummary.species.length > 0 && (
                    <ReadOnlyField 
                      label="Species" 
                      value={
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                          {metadata.assetsSummary.species.map((s, i) => (
                            <Chip 
                              key={i} 
                              label={typeof s === 'object' && s !== null && 'name' in s ? (s as { name: string }).name : String(s)} 
                              size="small"
                              variant="outlined"
                              sx={{ height: 20, fontSize: '0.7rem' }}
                            />
                          ))}
                        </Box>
                      }
                    />
                  )}
                </>
              )}

              {/* Manifest Location */}
              {metadata.manifestLocation && metadata.manifestLocation.length > 0 && (
                <ReadOnlyField 
                  label="Manifest" 
                  value={
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                      {metadata.manifestLocation.map((url, i) => (
                        <Link 
                          key={i} 
                          href={url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          sx={{ fontSize: '0.8rem' }}
                        >
                          {url.length > 60 ? url.slice(0, 60) + '...' : url}
                        </Link>
                      ))}
                    </Box>
                  }
                />
              )}
            </TableBody>
          </Table>
        </Box>
      </Collapse>
    </Box>
  );
}
