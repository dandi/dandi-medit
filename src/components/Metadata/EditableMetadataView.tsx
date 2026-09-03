import { useMemo, useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Chip,
  IconButton,
  Tooltip,
  Divider,
  Link,
  Alert,
  Snackbar,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import UndoIcon from '@mui/icons-material/Undo';
import DeleteIcon from '@mui/icons-material/Delete';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import TitleIcon from '@mui/icons-material/Title';
import DescriptionIcon from '@mui/icons-material/Description';
import LabelIcon from '@mui/icons-material/Label';
import GavelIcon from '@mui/icons-material/Gavel';
import PeopleIcon from '@mui/icons-material/People';
import CategoryIcon from '@mui/icons-material/Category';
import TrackChangesIcon from '@mui/icons-material/TrackChanges';
import LinkIcon from '@mui/icons-material/Link';
import VerifiedIcon from '@mui/icons-material/Verified';
import ThumbUpIcon from '@mui/icons-material/ThumbUp';
import LibraryBooksIcon from '@mui/icons-material/LibraryBooks';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import { useMetadataContext } from '../../context/useMetadataContext';
import { computeDelta, deltaToChanges } from '../../core/metadataDiff';
import type { MetadataOperationType } from '../../core/metadataOperations';
import { EditableTextField } from './EditableTextField';
import { EditableKeywordsList } from './EditableKeywordsList';
import { EditableLicenseSelect, LICENSE_OPTIONS } from './EditableLicenseSelect';

// Field definition type
interface FieldDef {
  key: string;
  title: string;
  type: 'string' | 'string[]' | 'array';
  icon: React.ComponentType<{ sx?: object }>;
}

// Section definition type
interface SectionDef {
  title: string;
  icon: React.ComponentType<{ sx?: object }>;
  fields: FieldDef[];
}

// Section groupings for better organization
const FIELD_SECTIONS: SectionDef[] = [
  {
    title: 'Basic Information',
    icon: DescriptionIcon,
    fields: [
      { key: 'name', title: 'Title', type: 'string', icon: TitleIcon },
      { key: 'description', title: 'Description', type: 'string', icon: DescriptionIcon },
      { key: 'keywords', title: 'Keywords', type: 'string[]', icon: LabelIcon },
      { key: 'license', title: 'License', type: 'string[]', icon: GavelIcon },
    ],
  },
  {
    title: 'People & Organizations',
    icon: PeopleIcon,
    fields: [
      { key: 'contributor', title: 'Contributors', type: 'array', icon: PeopleIcon },
    ],
  },
  {
    title: 'Study Details',
    icon: CategoryIcon,
    fields: [
      { key: 'about', title: 'Subject Matter', type: 'array', icon: CategoryIcon },
      { key: 'studyTarget', title: 'Study Target', type: 'string[]', icon: TrackChangesIcon },
      { key: 'protocol', title: 'Protocols', type: 'string[]', icon: LinkIcon },
    ],
  },
  {
    title: 'Compliance & Acknowledgements',
    icon: VerifiedIcon,
    fields: [
      { key: 'ethicsApproval', title: 'Ethics Approvals', type: 'array', icon: VerifiedIcon },
      { key: 'acknowledgement', title: 'Acknowledgement', type: 'string', icon: ThumbUpIcon },
    ],
  },
  {
    title: 'Related Items',
    icon: LibraryBooksIcon,
    fields: [
      { key: 'relatedResource', title: 'Related Resources', type: 'array', icon: LibraryBooksIcon },
      { key: 'wasGeneratedBy', title: 'Projects', type: 'array', icon: AccountTreeIcon },
    ],
  },
];

// Theme colors
const MODIFIED_BG = 'rgba(255, 193, 7, 0.12)';
const MODIFIED_BORDER = '#ffc107';
const SECTION_HEADER_BG = 'rgba(25, 118, 210, 0.08)';

interface FieldDisplayProps {
  fieldKey: string;
  title: string;
  value: unknown;
  isModified: boolean;
  type: string;
  icon?: React.ComponentType<{ sx?: object }>;
  onRevert?: () => void;
  onEdit?: (value: unknown) => { success: boolean; error?: string };
}

/**
 * Formats a primitive value for display
 */
function formatPrimitiveValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value || '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return String(value);
  return String(value);
}

/**
 * Checks if a string is a URL
 */
function isUrl(str: string): boolean {
  try {
    const url = new URL(str);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Checks if a string is an ORCID identifier (format: 0000-0000-0000-0000)
 */
function isOrcidId(str: string): boolean {
  return /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(str);
}

/**
 * Checks if a string is a DOI identifier (format: doi:10.xxxx/xxxxx)
 */
function isDoi(str: string): boolean {
  return /^doi:10\.\d{4,}\/\S+$/i.test(str);
}

/**
 * Checks if a string is a ROR identifier (format: ROR:xxxxxxx)
 */
function isRorId(str: string): boolean {
  return /^ROR:[a-z0-9]+$/i.test(str);
}

/**
 * Checks if a string is a linkable identifier (URL or known ID format)
 */
function isLinkable(str: string): boolean {
  return isUrl(str) || isOrcidId(str) || isDoi(str) || isRorId(str);
}

/**
 * Converts an identifier to a full URL if needed
 */
function getFullUrl(str: string): string {
  if (isOrcidId(str)) {
    return `https://orcid.org/${str}`;
  }
  if (isDoi(str)) {
    // Extract the DOI part after "doi:" and create the URL
    const doiPart = str.replace(/^doi:/i, '');
    return `https://doi.org/${doiPart}`;
  }
  if (isRorId(str)) {
    // Extract the ROR ID after "ROR:" and create the URL
    const rorPart = str.replace(/^ROR:/i, '');
    return `https://ror.org/${rorPart}`;
  }
  return str;
}

/**
 * Gets a display label for known URL types (ROR, ORCID, ontologies)
 */
function getUrlDisplayLabel(url: string): string {
  // ROR (Research Organization Registry)
  const rorMatch = url.match(/ror\.org\/([a-z0-9]+)/i);
  if (rorMatch) return `ROR:${rorMatch[1]}`;

  // ORCID
  const orcidMatch = url.match(/orcid\.org\/([\d-]+)/i);
  if (orcidMatch) return `ORCID:${orcidMatch[1]}`;

  // Ontologies - common patterns
  // OBI (Ontology for Biomedical Investigations)
  const obiMatch = url.match(/purl\.obolibrary\.org\/obo\/(OBI_\d+)/i);
  if (obiMatch) return obiMatch[1].replace('_', ':');

  // NCBI Taxonomy
  const ncbiMatch = url.match(/purl\.obolibrary\.org\/obo\/NCBITaxon_(\d+)/i);
  if (ncbiMatch) return `NCBITaxon:${ncbiMatch[1]}`;

  // Generic obolibrary ontology
  const oboMatch = url.match(/purl\.obolibrary\.org\/obo\/([A-Z]+_\d+)/i);
  if (oboMatch) return oboMatch[1].replace('_', ':');

  // DANDI identifiers
  const dandiMatch = url.match(/identifiers\.org\/DANDI:(\d+)/i);
  if (dandiMatch) return `DANDI:${dandiMatch[1]}`;

  // For other URLs, return a shortened version for display
  try {
    const urlObj = new URL(url);
    return urlObj.hostname + urlObj.pathname;
  } catch {
    return url;
  }
}

/**
 * Renders a value that may be a URL or linkable identifier as a clickable link
 */
function ValueOrLink({ value }: { value: string }) {
  if (isLinkable(value)) {
    const fullUrl = getFullUrl(value);
    // Keep ORCID, DOI, and ROR as-is for display, use friendly labels for URLs
    const displayLabel = (isOrcidId(value) || isDoi(value) || isRorId(value)) ? value : getUrlDisplayLabel(fullUrl);
    return (
      <Link
        href={fullUrl}
        target="_blank"
        rel="noopener noreferrer"
        sx={{ wordBreak: 'break-word' }}
      >
        {displayLabel}
      </Link>
    );
  }
  return <>{value || '—'}</>;
}

/**
 * Renders a string array as chips, with URLs and linkable identifiers rendered as clickable links
 */
function StringArrayDisplay({ values, isModified }: { values: string[]; isModified: boolean }) {
  if (!values || values.length === 0) {
    return <Typography variant="body2" color="text.secondary">None</Typography>;
  }

  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, overflow: 'hidden' }}>
      {values.map((value, idx) => {
        const valueIsLinkable = isLinkable(value);
        const fullUrl = valueIsLinkable ? getFullUrl(value) : value;
        const displayLabel = valueIsLinkable
          ? ((isOrcidId(value) || isDoi(value) || isRorId(value)) ? value : getUrlDisplayLabel(fullUrl))
          : value;

        const chip = (
          <Chip
            key={idx}
            label={displayLabel}
            size="small"
            clickable={valueIsLinkable}
            component={valueIsLinkable ? 'a' : 'div'}
            {...(valueIsLinkable ? { href: fullUrl, target: '_blank', rel: 'noopener noreferrer' } : {})}
            sx={{
              backgroundColor: isModified ? MODIFIED_BG : undefined,
              borderColor: isModified ? MODIFIED_BORDER : undefined,
              maxWidth: '100%',
              '& .MuiChip-label': {
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              },
              ...(valueIsLinkable && {
                cursor: 'pointer',
                '&:hover': {
                  textDecoration: 'underline',
                },
              }),
            }}
            variant={isModified ? 'outlined' : 'filled'}
          />
        );

        return chip;
      })}
    </Box>
  );
}

/**
 * Extracts identifiers (like ROR IDs) from a URL or returns the identifier as-is
 */
function formatIdentifier(identifier: string): string {
  // Extract ROR ID from URL like https://ror.org/0190ak572
  const rorMatch = identifier.match(/ror\.org\/([a-z0-9]+)/i);
  if (rorMatch) return `ROR:${rorMatch[1]}`;
  return identifier;
}

/**
 * Renders an affiliation with a clickable ROR link if available
 */
function AffiliationDisplay({ obj }: { obj: Record<string, unknown> }) {
  const name = typeof obj.name === 'string' ? obj.name : '';
  const identifier = typeof obj.identifier === 'string' ? obj.identifier : '';

  if (name && identifier) {
    const formattedId = formatIdentifier(identifier);
    // Get the link URL - either the original URL or construct from ROR ID
    const linkUrl = isUrl(identifier) ? identifier : (isRorId(formattedId) ? getFullUrl(formattedId) : null);

    return (
      <>
        {name} (
        {linkUrl ? (
          <Link href={linkUrl} target="_blank" rel="noopener noreferrer">
            {formattedId}
          </Link>
        ) : (
          formattedId
        )}
        )
      </>
    );
  }

  // If only identifier, check if it's linkable
  if (identifier) {
    return <ValueOrLink value={identifier} />;
  }

  return <>{name || '—'}</>;
}

/**
 * Extracts a display name from a complex object
 */
function getObjectDisplayName(obj: Record<string, unknown>): string {
  // Try common name fields
  if (typeof obj.name === 'string' && obj.name) return obj.name;
  if (typeof obj.identifier === 'string' && obj.identifier) return obj.identifier;
  if (typeof obj.url === 'string' && obj.url) return obj.url;
  
  // For contributors, might have schemaKey to distinguish Person vs Organization
  const schemaKey = obj.schemaKey as string | undefined;
  if (schemaKey === 'Person' && obj.name) return obj.name as string;
  if (schemaKey === 'Organization' && obj.name) return obj.name as string;
  
  return JSON.stringify(obj).slice(0, 50) + '...';
}

/**
 * Renders a single object's key-value pairs
 */
function ObjectDisplay({ obj, modifiedPaths }: { obj: Record<string, unknown>; modifiedPaths: Set<string> }) {
  // Filter out schemaKey and id fields
  const entries = Object.entries(obj).filter(
    ([key]) => !['schemaKey', 'id'].includes(key) && obj[key] !== null && obj[key] !== undefined
  );
  
  if (entries.length === 0) {
    return <Typography variant="body2" color="text.secondary">Empty</Typography>;
  }
  
  return (
    <Box sx={{ pl: 1 }}>
      {entries.map(([key, value]) => {
        const isFieldModified = modifiedPaths.has(key);
        return (
          <Box
            key={key}
            sx={{
              py: 0.25,
              backgroundColor: isFieldModified ? MODIFIED_BG : undefined,
              borderRadius: 0.5,
              px: 0.5,
              mb: 0.25,
            }}
          >
            <Typography variant="body2" color="text.secondary" component="span">
              {formatFieldLabel(key)}:{' '}
            </Typography>
            <Typography
              variant="body2"
              component="span"
              sx={{
                wordBreak: 'break-word',
              }}
            >
              {Array.isArray(value) ? (
                value.length > 0 ? (
                  typeof value[0] === 'object' ? (
                    // Render object arrays - check for affiliations
                    (value as Record<string, unknown>[]).map((item, i) => {
                      const isAffiliation = key === 'affiliation' || item.schemaKey === 'Affiliation';
                      return (
                        <span key={i}>
                          {i > 0 && ', '}
                          {isAffiliation ? (
                            <AffiliationDisplay obj={item} />
                          ) : (
                            getObjectDisplayName(item)
                          )}
                        </span>
                      );
                    })
                  ) : (
                    // Render string array values - check if they're URLs
                    (value as string[]).map((v, i) => (
                      <span key={i}>
                        {i > 0 && ', '}
                        <ValueOrLink value={String(v)} />
                      </span>
                    ))
                  )
                ) : (
                  '—'
                )
              ) : typeof value === 'object' && value !== null ? (
                getObjectDisplayName(value as Record<string, unknown>)
              ) : typeof value === 'string' ? (
                <ValueOrLink value={value} />
              ) : (
                formatPrimitiveValue(value)
              )}
            </Typography>
          </Box>
        );
      })}
    </Box>
  );
}

/**
 * Renders an array of complex objects with expandable items
 */
function ComplexArrayDisplay({
  items,
  fieldKey,
  changedPaths,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  items: unknown[];
  fieldKey: string;
  changedPaths: Set<string>;
  onDelete?: (index: number) => void;
  onMoveUp?: (index: number) => void;
  onMoveDown?: (index: number) => void;
}) {
  const [expanded, setExpanded] = useState<number | false>(false);

  if (!items || items.length === 0) {
    return <Typography variant="body2" color="text.secondary">None</Typography>;
  }

  return (
    <Box>
      {items.map((item, idx) => {
        const itemPath = `${fieldKey}[${idx}]`;
        // Check if any path starts with this item's path
        const isItemModified = Array.from(changedPaths).some(
          (p) => p === itemPath || p.startsWith(`${itemPath}.`) || p.startsWith(`${itemPath}[`)
        );

        const obj = item as Record<string, unknown>;
        const displayName = getObjectDisplayName(obj);
        const schemaKey = obj.schemaKey as string | undefined;

        // Get modified paths relative to this item
        const itemModifiedPaths = new Set<string>();
        changedPaths.forEach((p) => {
          if (p.startsWith(`${itemPath}.`)) {
            itemModifiedPaths.add(p.slice(itemPath.length + 1));
          }
        });

        return (
          <Accordion
            key={idx}
            expanded={expanded === idx}
            onChange={(_, isExpanded) => setExpanded(isExpanded ? idx : false)}
            sx={{
              backgroundColor: isItemModified ? MODIFIED_BG : 'background.paper',
              border: isItemModified ? `1px solid ${MODIFIED_BORDER}` : undefined,
              '&:before': { display: 'none' },
              boxShadow: 'none',
              '&.Mui-expanded': { margin: 0 },
            }}
          >
            <AccordionSummary
              expandIcon={<ExpandMoreIcon />}
              sx={{ minHeight: 40, '&.Mui-expanded': { minHeight: 40 } }}
            >
              <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.5, width: '100%' }}>
                {schemaKey && (
                  <Chip label={schemaKey} size="small" variant="outlined" sx={{ fontSize: '0.7rem' }} />
                )}
                {isItemModified && (
                  <Chip label="modified" size="small" color="warning" sx={{ fontSize: '0.65rem', height: 18 }} />
                )}
                <Typography variant="body2" sx={{ flex: 1, wordBreak: 'break-word' }}>
                  {displayName}
                </Typography>
                <Box
                  sx={{ display: 'flex', ml: 'auto' }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {onMoveUp && (
                    <Tooltip title="Move up">
                      <span>
                        <IconButton
                          size="small"
                          onClick={() => onMoveUp(idx)}
                          disabled={idx === 0}
                          sx={{ p: 0.25 }}
                        >
                          <ArrowUpwardIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                      </span>
                    </Tooltip>
                  )}
                  {onMoveDown && (
                    <Tooltip title="Move down">
                      <span>
                        <IconButton
                          size="small"
                          onClick={() => onMoveDown(idx)}
                          disabled={idx === items.length - 1}
                          sx={{ p: 0.25 }}
                        >
                          <ArrowDownwardIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                      </span>
                    </Tooltip>
                  )}
                  {onDelete && (
                    <Tooltip title="Delete">
                      <IconButton
                        size="small"
                        onClick={() => onDelete(idx)}
                        color="error"
                        sx={{ p: 0.25 }}
                      >
                        <DeleteIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                    </Tooltip>
                  )}
                </Box>
              </Box>
            </AccordionSummary>
            <AccordionDetails sx={{ pt: 0 }}>
              <ObjectDisplay obj={obj} modifiedPaths={itemModifiedPaths} />
            </AccordionDetails>
          </Accordion>
        );
      })}
    </Box>
  );
}

/**
 * Convert camelCase to Title Case
 */
function formatFieldLabel(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (str) => str.toUpperCase())
    .trim();
}

/**
 * Single field display component
 */
function FieldDisplay({ fieldKey, title, value, isModified, type, icon: Icon, onRevert, onEdit }: FieldDisplayProps) {
  const isEmpty =
    value === null ||
    value === undefined ||
    (Array.isArray(value) && value.length === 0) ||
    (typeof value === 'string' && !value);

  // Determine if this field is editable
  const isEditableText = fieldKey === 'name' || fieldKey === 'description';
  const useDialog = fieldKey === 'description'; // Description uses dialog due to length
  const maxLength = fieldKey === 'name' ? 150 : fieldKey === 'description' ? 10000 : undefined;

  return (
    <Box
      sx={{
        py: 1.5,
        px: 2,
        backgroundColor: isModified ? MODIFIED_BG : 'transparent',
        borderLeft: isModified ? `3px solid ${MODIFIED_BORDER}` : '3px solid transparent',
        borderRadius: 1,
        mb: 1,
        transition: 'all 0.2s ease',
        '&:hover': {
          backgroundColor: isModified ? MODIFIED_BG : 'rgba(0, 0, 0, 0.02)',
        },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.75 }}>
        {Icon && <Icon sx={{ fontSize: 16, color: 'text.secondary' }} />}
        <Typography
          variant="subtitle2"
          sx={{
            fontWeight: 600,
            color: 'text.primary',
            fontSize: '0.85rem',
          }}
        >
          {title}
        </Typography>
        {/* Edit button for editable text fields */}
        {isEditableText && onEdit && (
          <EditableTextField
            value={value as string}
            onSave={(newValue) => onEdit(newValue)}
            label={title}
            maxLength={maxLength}
            multiline={fieldKey === 'description'}
            useDialog={useDialog}
          />
        )}
        {isModified && (
          <>
            <Chip
              label="modified"
              size="small"
              color="warning"
              sx={{ fontSize: '0.65rem', height: 20, ml: 0.5 }}
            />
            <Tooltip title="Revert to original">
              <IconButton size="small" onClick={onRevert} sx={{ p: 0.25, ml: 0.5 }}>
                <UndoIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          </>
        )}
      </Box>
      
      {isEmpty ? (
        <Typography variant="body2" color="text.secondary" fontStyle="italic">
          Not specified
        </Typography>
      ) : type === 'string' ? (
        <Typography
          variant="body2"
          sx={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            lineHeight: 1.6,
            color: 'text.primary',
          }}
        >
          {formatPrimitiveValue(value)}
        </Typography>
      ) : type === 'string[]' ? (
        <StringArrayDisplay values={value as string[]} isModified={isModified} />
      ) : (
        <Typography variant="body2">{JSON.stringify(value)}</Typography>
      )}
    </Box>
  );
}

/**
 * Helper to format license value for display
 */
function formatLicenseValue(license: string): string {
  const option = LICENSE_OPTIONS.find((opt) => opt.value === license);
  return option ? option.label : license;
}

/**
 * Renders a single section with its fields
 */
function SectionDisplay({
  section,
  modifiedMetadata,
  changedPaths,
  isFieldModified,
  revertField,
  onEditField,
  modifyMetadata,
  onError,
}: {
  section: SectionDef;
  modifiedMetadata: Record<string, unknown>;
  changedPaths: Set<string>;
  isFieldModified: (key: string) => boolean;
  revertField: (key: string) => void;
  onEditField: (key: string, value: unknown) => { success: boolean; error?: string };
  modifyMetadata: (operation: MetadataOperationType, path: string, value?: unknown) => { success: boolean; error?: string };
  onError: (message: string) => void;
}) {
  const SectionIcon = section.icon;
  
  // Check if section has any modified fields
  const sectionHasModifications = section.fields.some((field) => isFieldModified(field.key));
  
  return (
    <Paper
      elevation={0}
      sx={{
        mb: 2,
        border: '1px solid',
        borderColor: sectionHasModifications ? MODIFIED_BORDER : 'divider',
        borderRadius: 2,
        overflow: 'hidden',
        transition: 'border-color 0.2s ease',
      }}
    >
      {/* Section Header */}
      <Box
        sx={{
          px: 2,
          py: 1.5,
          backgroundColor: SECTION_HEADER_BG,
          borderBottom: '1px solid',
          borderColor: 'divider',
          display: 'flex',
          alignItems: 'center',
          gap: 1,
        }}
      >
        <SectionIcon sx={{ fontSize: 20, color: 'primary.main' }} />
        <Typography
          variant="subtitle1"
          sx={{
            fontWeight: 600,
            color: 'text.primary',
          }}
        >
          {section.title}
        </Typography>
        {sectionHasModifications && (
          <Chip
            label="has changes"
            size="small"
            color="warning"
            variant="outlined"
            sx={{ fontSize: '0.7rem', height: 22, ml: 'auto' }}
          />
        )}
      </Box>
      
      {/* Section Fields */}
      <Box sx={{ p: 1.5 }}>
        {section.fields.map((field, idx) => {
          const value = modifiedMetadata[field.key];
          const modified = isFieldModified(field.key);
          const FieldIcon = field.icon;
          
          // Handle keywords field specially
          if (field.key === 'keywords') {
            return (
              <Box key={field.key}>
                {idx > 0 && <Divider sx={{ my: 1.5 }} />}
                <Box
                  sx={{
                    py: 1.5,
                    px: 2,
                    backgroundColor: modified ? MODIFIED_BG : 'transparent',
                    borderLeft: modified ? `3px solid ${MODIFIED_BORDER}` : '3px solid transparent',
                    borderRadius: 1,
                    mb: 1,
                    transition: 'all 0.2s ease',
                    '&:hover': {
                      backgroundColor: modified ? MODIFIED_BG : 'rgba(0, 0, 0, 0.02)',
                    },
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.75 }}>
                    <FieldIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                    <Typography
                      variant="subtitle2"
                      sx={{
                        fontWeight: 600,
                        color: 'text.primary',
                        fontSize: '0.85rem',
                      }}
                    >
                      {field.title}
                    </Typography>
                    <EditableKeywordsList
                      value={value as string[]}
                      onSave={(newValue) => {
                        const result = onEditField(field.key, newValue);
                        if (!result.success) onError(result.error ?? 'Failed to update keywords');
                      }}
                    />
                    {modified && (
                      <>
                        <Chip
                          label="modified"
                          size="small"
                          color="warning"
                          sx={{ fontSize: '0.65rem', height: 20, ml: 0.5 }}
                        />
                        <Tooltip title="Revert to original">
                          <IconButton size="small" onClick={() => revertField(field.key)} sx={{ p: 0.25, ml: 0.5 }}>
                            <UndoIcon sx={{ fontSize: 16 }} />
                          </IconButton>
                        </Tooltip>
                      </>
                    )}
                  </Box>
                  <StringArrayDisplay values={value as string[]} isModified={modified} />
                </Box>
              </Box>
            );
          }
          
          // Handle license field specially
          if (field.key === 'license') {
            const licenseValues = value as string[] | null | undefined;
            return (
              <Box key={field.key}>
                {idx > 0 && <Divider sx={{ my: 1.5 }} />}
                <Box
                  sx={{
                    py: 1.5,
                    px: 2,
                    backgroundColor: modified ? MODIFIED_BG : 'transparent',
                    borderLeft: modified ? `3px solid ${MODIFIED_BORDER}` : '3px solid transparent',
                    borderRadius: 1,
                    mb: 1,
                    transition: 'all 0.2s ease',
                    '&:hover': {
                      backgroundColor: modified ? MODIFIED_BG : 'rgba(0, 0, 0, 0.02)',
                    },
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.75 }}>
                    <FieldIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                    <Typography
                      variant="subtitle2"
                      sx={{
                        fontWeight: 600,
                        color: 'text.primary',
                        fontSize: '0.85rem',
                      }}
                    >
                      {field.title}
                    </Typography>
                    <EditableLicenseSelect
                      value={licenseValues}
                      onSave={(newValue) => {
                        const result = onEditField(field.key, newValue);
                        if (!result.success) onError(result.error ?? 'Failed to update license');
                      }}
                    />
                    {modified && (
                      <>
                        <Chip
                          label="modified"
                          size="small"
                          color="warning"
                          sx={{ fontSize: '0.65rem', height: 20, ml: 0.5 }}
                        />
                        <Tooltip title="Revert to original">
                          <IconButton size="small" onClick={() => revertField(field.key)} sx={{ p: 0.25, ml: 0.5 }}>
                            <UndoIcon sx={{ fontSize: 16 }} />
                          </IconButton>
                        </Tooltip>
                      </>
                    )}
                  </Box>
                  {licenseValues && licenseValues.length > 0 ? (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                      {licenseValues.map((license, licIdx) => (
                        <Chip
                          key={licIdx}
                          label={formatLicenseValue(license)}
                          size="small"
                          sx={{
                            backgroundColor: modified ? MODIFIED_BG : undefined,
                            borderColor: modified ? MODIFIED_BORDER : undefined,
                          }}
                          variant={modified ? 'outlined' : 'filled'}
                        />
                      ))}
                    </Box>
                  ) : (
                    <Typography variant="body2" color="text.secondary" fontStyle="italic">
                      Not specified
                    </Typography>
                  )}
                </Box>
              </Box>
            );
          }
          
          if (field.type === 'array') {
            return (
              <Box key={field.key}>
                {idx > 0 && <Divider sx={{ my: 1.5 }} />}
                <Box
                  sx={{
                    py: 1,
                    px: 2,
                    backgroundColor: modified ? MODIFIED_BG : 'transparent',
                    borderLeft: modified ? `3px solid ${MODIFIED_BORDER}` : '3px solid transparent',
                    borderRadius: 1,
                    transition: 'all 0.2s ease',
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1 }}>
                    <FieldIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                    <Typography
                      variant="subtitle2"
                      sx={{
                        fontWeight: 600,
                        color: 'text.primary',
                        fontSize: '0.85rem',
                      }}
                    >
                      {field.title}
                    </Typography>
                    {modified && (
                      <>
                        <Chip
                          label="modified"
                          size="small"
                          color="warning"
                          sx={{ fontSize: '0.65rem', height: 20, ml: 0.5 }}
                        />
                        <Tooltip title="Revert to original">
                          <IconButton size="small" onClick={() => revertField(field.key)} sx={{ p: 0.25, ml: 0.5 }}>
                            <UndoIcon sx={{ fontSize: 16 }} />
                          </IconButton>
                        </Tooltip>
                      </>
                    )}
                    {Array.isArray(value) && (
                      <Chip
                        label={`${value.length} item${value.length !== 1 ? 's' : ''}`}
                        size="small"
                        variant="outlined"
                        sx={{ fontSize: '0.7rem', height: 20, ml: 'auto' }}
                      />
                    )}
                  </Box>
                  <ComplexArrayDisplay
                    items={value as unknown[]}
                    fieldKey={field.key}
                    changedPaths={changedPaths}
                    onDelete={(idx) => {
                      const result = modifyMetadata('delete', `${field.key}.${idx}`);
                      if (!result.success) onError(result.error ?? 'Failed to delete item');
                    }}
                    onMoveUp={(idx) => {
                      if (idx <= 0) return;
                      const arr = [...(value as unknown[])];
                      const [item] = arr.splice(idx, 1);
                      arr.splice(idx - 1, 0, item);
                      const result = modifyMetadata('set', field.key, arr);
                      if (!result.success) onError(result.error ?? 'Failed to move item up');
                    }}
                    onMoveDown={(idx) => {
                      const arr = [...(value as unknown[])];
                      if (idx >= arr.length - 1) return;
                      const [item] = arr.splice(idx, 1);
                      arr.splice(idx + 1, 0, item);
                      const result = modifyMetadata('set', field.key, arr);
                      if (!result.success) onError(result.error ?? 'Failed to move item down');
                    }}
                  />
                </Box>
              </Box>
            );
          }
          
          return (
            <Box key={field.key}>
              {idx > 0 && <Divider sx={{ my: 1.5 }} />}
              <FieldDisplay
                fieldKey={field.key}
                title={field.title}
                value={value}
                isModified={modified}
                type={field.type}
                icon={FieldIcon}
                onRevert={() => revertField(field.key)}
                onEdit={(newValue) => onEditField(field.key, newValue)}
              />
            </Box>
          );
        })}
      </Box>
    </Paper>
  );
}

/**
 * Main component for displaying editable metadata with change highlighting
 */
export function EditableMetadataView() {
  const { originalMetadata, modifiedMetadata, revertField, modifyMetadata } = useMetadataContext();
  const [editError, setEditError] = useState<string | null>(null);
  
  // Compute changed paths
  const changedPaths = useMemo(() => {
    const paths = new Set<string>();
    if (!originalMetadata || !modifiedMetadata) return paths;
    
    const delta = computeDelta(originalMetadata, modifiedMetadata);
    if (!delta) return paths;
    
    const changes = deltaToChanges(delta);
    changes.forEach((change) => paths.add(change.path));
    
    return paths;
  }, [originalMetadata, modifiedMetadata]);
  
  if (!modifiedMetadata) {
    return null;
  }
  
  // Check if a field or any of its nested paths are modified
  const isFieldModified = (fieldKey: string): boolean => {
    return Array.from(changedPaths).some(
      (p) => p === fieldKey || p.startsWith(`${fieldKey}.`) || p.startsWith(`${fieldKey}[`)
    );
  };
  
  // Handler for editing fields - returns result for error handling
  const handleEditField = (fieldKey: string, value: unknown): { success: boolean; error?: string } => {
    return modifyMetadata('set', fieldKey, value);
  };
  
  // Count total modifications
  const modifiedCount = FIELD_SECTIONS.flatMap((s) => s.fields)
    .filter((f) => isFieldModified(f.key)).length;
  
  return (
    <Box sx={{ mt: 2 }}>
      {/* Header */}
      <Paper
        elevation={0}
        sx={{
          mb: 2,
          p: 2,
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 2,
          background: 'linear-gradient(135deg, rgba(25, 118, 210, 0.05) 0%, rgba(25, 118, 210, 0.02) 100%)',
        }}
      >
        <Typography variant="h6" fontWeight="bold" gutterBottom>
          Editable Metadata
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Review the metadata fields below. Fields highlighted in{' '}
          <Box
            component="span"
            sx={{
              backgroundColor: MODIFIED_BG,
              border: `1px solid ${MODIFIED_BORDER}`,
              borderRadius: 0.5,
              px: 0.75,
              py: 0.25,
            }}
          >
            yellow
          </Box>{' '}
          have been modified from the original. Click the edit icon to modify fields directly.
        </Typography>
        {modifiedCount > 0 && (
          <Chip
            label={`${modifiedCount} field${modifiedCount !== 1 ? 's' : ''} modified`}
            color="warning"
            size="small"
            sx={{ mt: 1 }}
          />
        )}
      </Paper>
      
      {/* Sections */}
      {FIELD_SECTIONS.map((section) => (
        <SectionDisplay
          key={section.title}
          section={section}
          modifiedMetadata={modifiedMetadata as unknown as Record<string, unknown>}
          changedPaths={changedPaths}
          isFieldModified={isFieldModified}
          revertField={revertField}
          onEditField={handleEditField}
          modifyMetadata={modifyMetadata}
          onError={setEditError}
        />
      ))}

      {/* Error snackbar for rejected edits */}
      <Snackbar
        open={!!editError}
        autoHideDuration={10000}
        onClose={() => setEditError(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setEditError(null)}
          severity="error"
          variant="filled"
          sx={{ width: '100%' }}
        >
          {editError}
        </Alert>
      </Snackbar>
    </Box>
  );
}
