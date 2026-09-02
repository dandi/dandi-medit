/* eslint-disable @typescript-eslint/no-explicit-any */
import { getReadOnlyFieldsSync } from "../../schemas/schemaService";
import { QPTool, ToolExecutionContext, MetadataOperationType } from "../types";
import { validateIdentifierInValue, normalizeOrcid } from "./validateUrls";

interface SingleChange {
  operation: MetadataOperationType;
  path: string;
  value?: any;
}

export const proposeMetadataChangeTool: QPTool = {
  toolFunction: {
    name: "propose_metadata_change",
    description:
      "Propose one or more changes to the dandiset metadata. Supports setting values, deleting array items, inserting into arrays, and appending to arrays. Changes are added to the pending changes list for user review before committing. Use the 'changes' array to apply multiple changes in one call.",
    parameters: {
      type: "object",
      properties: {
        changes: {
          type: "array",
          description:
            "An array of changes to apply. Each change should have 'operation', 'path', and optionally 'value'. " +
            "Use this to apply multiple changes in a single tool call.",
          items: {
            type: "object",
            properties: {
              operation: {
                type: "string",
                enum: ["set", "delete", "insert", "append"],
                description: "The type of operation to perform.",
              },
              path: {
                type: "string",
                description: "The dot-notation path to the field.",
              },
              value: {
                description: "The value to set, insert, or append.",
              },
            },
            required: ["operation", "path"],
          },
        },
        operation: {
          type: "string",
          enum: ["set", "delete", "insert", "append"],
          description:
            "(For single change) The type of operation to perform:\n" +
            "- 'set': Set a value at the specified path (create or update)\n" +
            "- 'delete': Delete an item from an array by index\n" +
            "- 'insert': Insert a value at a specific array index (shifts others right)\n" +
            "- 'append': Add a value to the end of an array",
        },
        path: {
          type: "string",
          description:
            "(For single change) The dot-notation path to the field (e.g., 'name', 'contributor.0.name', 'keywords.2').\n" +
            "For 'delete' and 'insert': path must end with an array index.\n" +
            "For 'append': path should point to the array itself (e.g., 'keywords').",
        },
        value: {
          description:
            "(For single change) The value to set, insert, or append. Required for 'set', 'insert', and 'append' operations. " +
            "Can be a string, number, boolean, array, or object depending on the field type.",
        },
        explanation: {
          type: "string",
          description:
            "A brief explanation of why these changes are being proposed (for user context).",
        },
      },
      required: [],
    },
  },

  execute: async (
    params: {
      changes?: SingleChange[];
      operation?: MetadataOperationType;
      path?: string;
      value?: any;
      // Legacy support
      newValue?: any;
      explanation?: string
    },
    context: ToolExecutionContext,
  ) => {
    const { explanation } = params;
    const readOnlyFields = getReadOnlyFieldsSync();

    // The schema stores ORCIDs as the bare identifier, so reduce any orcid.org
    // URL to that form before the value is validated and applied.
    const normalizeOrcidInValue = (path: string, value: any): any => {
      if (typeof value === "string" && /contributor\.\d+\.identifier$/.test(path)) {
        return normalizeOrcid(value);
      }
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        const obj = value as Record<string, any>;
        if (obj.schemaKey === "Person" && typeof obj.identifier === "string") {
          return { ...obj, identifier: normalizeOrcid(obj.identifier) };
        }
      }
      return value;
    };
    const validOperations: MetadataOperationType[] = ['set', 'delete', 'insert', 'append'];

    // Build the list of changes to apply
    let changes: SingleChange[];
    
    if (params.changes && params.changes.length > 0) {
      // Use the changes array
      changes = params.changes;
    } else if (params.path) {
      // Backward compatibility: single change via individual params
      const value = params.value ?? params.newValue;
      const operation: MetadataOperationType = params.operation ?? 'set';
      changes = [{ operation, path: params.path, value }];
    } else {
      return {
        result: JSON.stringify({
          success: false,
          error: "Either 'changes' array or 'path' must be provided.",
        }),
      };
    }

    const results: any[] = [];
    let allSucceeded = true;

    for (let i = 0; i < changes.length; i++) {
      const change = changes[i];
      const { operation = 'set', path } = change;
      const value = normalizeOrcidInValue(path, change.value);

      // Validate operation
      if (!validOperations.includes(operation)) {
        results.push({
          success: false,
          index: i,
          path,
          error: `Invalid operation "${operation}". Must be one of: ${validOperations.join(', ')}`,
        });
        allSucceeded = false;
        continue;
      }

      // Check if the field is readOnly
      const rootField = path.split(".")[0];
      if (readOnlyFields.has(rootField)) {
        results.push({
          success: false,
          index: i,
          path,
          error: `The field "${rootField}" is read-only and cannot be modified.`,
        });
        allSucceeded = false;
        continue;
      }

      // Validate that value is provided for operations that require it
      if ((operation === 'set' || operation === 'insert' || operation === 'append') && value === undefined) {
        results.push({
          success: false,
          index: i,
          path,
          error: `The "${operation}" operation requires a value to be provided.`,
        });
        allSucceeded = false;
        continue;
      }

      // Validate that contact persons have an email address
      if (value !== undefined) {
        const contributorObj = typeof value === 'object' && value !== null ? value as any : null;

        // Case 1: Setting/appending a full contributor object with ContactPerson role but no email
        if (contributorObj) {
          const isContributorEntry =
            ((operation === 'append' || operation === 'insert') && path === 'contributor') ||
            (operation === 'set' && /^contributor\.\d+$/.test(path));
          if (isContributorEntry) {
            const roles: string[] = contributorObj.roleName || [];
            if (roles.includes('dcite:ContactPerson') && !contributorObj.email) {
              results.push({
                success: false,
                index: i,
                path,
                error: `Contact person must have an email address. Please include the "email" field for contributors with the "dcite:ContactPerson" role.`,
              });
              allSucceeded = false;
              continue;
            }
          }
        }

        // Case 2: Setting roleName on an existing contributor to include ContactPerson
        const roleNameMatch = path.match(/^contributor\.(\d+)\.roleName$/);
        if (roleNameMatch && Array.isArray(value) && value.includes('dcite:ContactPerson')) {
          const contribIndex = parseInt(roleNameMatch[1], 10);
          const currentMetadata = context.modifiedMetadata || context.originalMetadata;
          const contributor = currentMetadata?.contributor?.[contribIndex];
          if (contributor && !contributor.email) {
            results.push({
              success: false,
              index: i,
              path,
              error: `Contact person must have an email address. The contributor at index ${contribIndex} does not have an email. Please set their email before assigning the "dcite:ContactPerson" role.`,
            });
            allSucceeded = false;
            continue;
          }
        }
      }

      // Validate award numbers don't contain descriptive prefixes
      if (value !== undefined) {
        const awardNumbersToCheck: { awardNumber: string; location: string }[] = [];

        // Direct awardNumber field (e.g., path = "contributor.0.awardNumber")
        if (/\.awardNumber$/.test(path) && typeof value === 'string') {
          awardNumbersToCheck.push({ awardNumber: value, location: path });
        }
        // Object with awardNumber property (e.g., appending a funder object)
        if (typeof value === 'object' && value !== null && (value as any).awardNumber) {
          awardNumbersToCheck.push({ awardNumber: (value as any).awardNumber, location: `${path}.awardNumber` });
        }

        const prefixPattern = /^(project\s*(number|no\.?|#)?|grant\s*(number|no\.?|#)?|award\s*(number|no\.?|#)?|no\.?|#)\s*/i;
        for (const { awardNumber, location } of awardNumbersToCheck) {
          if (prefixPattern.test(awardNumber)) {
            const cleaned = awardNumber.replace(prefixPattern, '').trim();
            results.push({
              success: false,
              index: i,
              path,
              error: `Award number at "${location}" should be only the identifier (e.g., "${cleaned}"), not prefixed with descriptive text like "${awardNumber}".`,
            });
            allSucceeded = false;
            continue;
          }
        }
        if (!allSucceeded && results[results.length - 1]?.index === i) continue;
      }

      // Validate URLs and identifiers (ORCID, ROR IDs) before applying changes
      if (value !== undefined) {
        const validationResult = await validateIdentifierInValue(path, value);
        if (!validationResult.isValid) {
          results.push({
            success: false,
            index: i,
            path,
            error: validationResult.error || `Invalid identifier or URL in value.`,
          });
          allSucceeded = false;
          continue;
        }
      }

      // Apply the operation
      const modifyResult = context.modifyMetadata(operation, path, value);

      if (!modifyResult.success) {
        results.push({
          success: false,
          index: i,
          path,
          error: modifyResult.error || `Failed to apply ${operation} operation at path "${path}".`,
        });
        allSucceeded = false;
        continue;
      }

      const result: any = {
        success: true,
        index: i,
        operation,
        path,
        message: getSuccessMessage(operation, path),
      };

      if (value !== undefined) {
        result.value = value;
      }

      results.push(result);
    }

    // Build response
    const response: any = {
      success: allSucceeded,
      totalChanges: changes.length,
      successfulChanges: results.filter(r => r.success).length,
      failedChanges: results.filter(r => !r.success).length,
    };

    if (changes.length === 1) {
      // Single change: return flat response for backward compatibility
      const singleResult = results[0];
      if (explanation) {
        singleResult.explanation = explanation;
      }
      return { result: JSON.stringify(singleResult) };
    }

    // Multiple changes: return full results
    response.results = results;
    if (explanation) {
      response.explanation = explanation;
    }

    return {
      result: JSON.stringify(response),
    };
  },

  getDetailedDescription: () => {
    return `Use this tool to propose changes to the dandiset metadata.

**Multiple Changes:**

You can apply multiple changes in a single call using the 'changes' array:
{ "changes": [
    { "operation": "set", "path": "name", "value": "New Name" },
    { "operation": "append", "path": "keywords", "value": "neuroscience" },
    { "operation": "delete", "path": "keywords.0" }
  ],
  "explanation": "Update name and keywords"
}

**Operations:**

1. **set** - Set or update a value at any path
   - Path: Any valid path (e.g., "name", "contributor.0.email")
   - Requires: value

2. **delete** - Remove an item from an array
   - Path: Must end with an array index (e.g., "keywords.2", "contributor.1")
   - No value required

3. **insert** - Insert an item at a specific array position
   - Path: Must end with an array index where item will be inserted
   - Requires: value
   - Items at and after this index shift right

4. **append** - Add an item to the end of an array
   - Path: Points to the array itself (e.g., "keywords", "contributor")
   - Requires: value

**Single Change Examples:**

- Set the name:
  { "operation": "set", "path": "name", "value": "New Dandiset Name" }

- Update a contributor's email:
  { "operation": "set", "path": "contributor.0.email", "value": "new@example.com" }

- Delete the third keyword:
  { "operation": "delete", "path": "keywords.2" }

- Append a new keyword:
  { "operation": "append", "path": "keywords", "value": "electrophysiology" }

**Batch Change Example:**

Apply multiple keyword changes at once:
{ "changes": [
    { "operation": "append", "path": "keywords", "value": "electrophysiology" },
    { "operation": "append", "path": "keywords", "value": "calcium-imaging" },
    { "operation": "append", "path": "keywords", "value": "mouse" }
  ]
}

**Notes:**
- Changes are not applied immediately; they are added to a pending changes list
- Users can review all pending changes before committing them
- For backward compatibility, single change params (operation, path, value) are still supported
- When using 'changes' array, each change is validated and applied independently

**URL and Identifier Validation:**
- ORCID identifiers are validated against the ORCID API to ensure they exist
- ROR IDs (organization identifiers) are validated against the ROR API to ensure they exist
- URLs in contributor profiles and other fields are checked to ensure they resolve
- If validation fails, the change will be rejected with an error message explaining why

**Read-only fields (cannot be modified):**
id, schemaVersion, url, repository, identifier, dateCreated, dateModified,
citation, assetsSummary, manifestLocation, version, access`;
  },
};

function getSuccessMessage(operation: MetadataOperationType, path: string): string {
  switch (operation) {
    case 'set':
      return `Successfully proposed setting "${path}". The change is now pending user review.`;
    case 'delete':
      return `Successfully proposed deleting item at "${path}". The change is now pending user review.`;
    case 'insert':
      return `Successfully proposed inserting item at "${path}". The change is now pending user review.`;
    case 'append':
      return `Successfully proposed appending item to "${path}". The change is now pending user review.`;
    default:
      return `Successfully proposed change to "${path}". The change is now pending user review.`;
  }
}
