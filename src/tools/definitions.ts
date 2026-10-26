/**
 * ツール定義（入力スキーマ）。実装は handlers.ts。
 * すべてのツールは additionalProperties: false を持ち、未知の引数は SDK の入力検証で弾かれる。
 */
import type { JsonSchemaType, Tool } from '@modelcontextprotocol/server';

export type ToolDefinition = Omit<Tool, 'inputSchema'> & { inputSchema: JsonSchemaType };

const pathParam = {
  type: 'string',
  description: 'File path of the data module (or PM) to check.',
} as const;
const xmlParam = {
  type: 'string',
  description: 'The document as an XML string (alternative to path; max 5 MB).',
} as const;
const csdbDirsParam = {
  type: 'array',
  items: { type: 'string' },
  description:
    'Extra CSDB folders to search for referenced data modules, publication modules, ICN files and BREX (in addition to S1000D_CSDB_DIR; BREX also under S1000D_SPEC_DIR).',
} as const;
const skipParam = {
  type: 'array',
  items: { type: 'string', enum: ['schema', 'brex', 'references'] },
  description: 'Steps to skip. Skipped steps are reported with state "not-run".',
} as const;

export const tools: ToolDefinition[] = [
  {
    name: 'verify_data_module',
    description:
      'Verify one S1000D data module: well-formedness, XML schema (XSD) validation against the user\'s own S1000D schemas (S1000D_SPEC_DIR), BREX checks along the brexDmRef chain, and reference resolution (dmRef, pmRef, ICN entities, internalRef, applicRefId). Returns a "verification" status (the same VerificationStatus that s1000d-reader-mcp embeds) plus the details of each step. Does NOT decide S1000D conformance.',
    inputSchema: {
      type: 'object',
      properties: {
        path: pathParam,
        xml: xmlParam,
        csdbDirs: csdbDirsParam,
        skip: skipParam,
        maxSchemaErrors: {
          type: 'number',
          description:
            'Cap on XSD errors returned (default 100). The total count is always reported.',
          default: 100,
        },
        maxViolationsPerLayer: {
          type: 'number',
          description: 'Cap on BREX violations returned per layer (default 200).',
          default: 200,
        },
        maxUnresolvedRefs: {
          type: 'number',
          description: 'Cap on unresolved references returned (default 200).',
          default: 200,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'validate_schema',
    description:
      'Validate one document against the S1000D XML schema (XSD) named by its xsi:noNamespaceSchemaLocation. The XSD is taken from the xml_schema_flat/ folder found under S1000D_SPEC_DIR (the issue is read from brex.xsd there). Errors are libxml2 messages with line/column. Returns schema-not-found with a reason when no suitable XSD is available.',
    inputSchema: {
      type: 'object',
      properties: {
        path: pathParam,
        xml: xmlParam,
        issue: {
          type: 'string',
          description:
            'S1000D issue of the XSD to use when several xml_schema_flat/ folders exist (e.g. "7", "4.2"). Default: inferred from the schemaLocation URL.',
        },
        maxErrors: {
          type: 'number',
          description: 'Cap on errors returned (default 100).',
          default: 100,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'check_references',
    description:
      'List the references of one document and whether each target exists: dmRef (all contexts: brexDmRef, applicCrossRefTableRef, pmEntry, body), pmRef, ICN (graphic/@infoEntityIdent via the DOCTYPE ENTITY declaration to a file), internalRef (ids in the same document) and applicRefId (applic ids or referencedApplicGroupRef/applicRef). Unresolved references carry a reason (not-found, no-entity-declaration, file-not-found, no-such-id, no-csdb). dmRef to modelIdentCode "S1000D" point to the specification itself and are listed separately.',
    inputSchema: {
      type: 'object',
      properties: {
        path: pathParam,
        xml: xmlParam,
        csdbDirs: csdbDirsParam,
        kinds: {
          type: 'array',
          items: { type: 'string', enum: ['dmRef', 'pmRef', 'icn', 'internalRef', 'applicRef'] },
          description: 'Reference kinds to report (default: all).',
        },
        includeResolved: {
          type: 'boolean',
          description:
            'Also list resolved references with the file they resolve to (default false; counts are always returned).',
          default: false,
        },
        maxItems: {
          type: 'number',
          description: 'Cap on listed references (default 200).',
          default: 200,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'verify_csdb',
    description:
      'Verify every CSDB object (data modules by default; optionally publication modules etc.) found in the given folders, and return one VerificationStatus per object plus totals (valid / XSD errors / BREX violations / unresolved references / unreadable). Use offset/limit to page. Pass reportPath to also write the full JSON report to a file.',
    inputSchema: {
      type: 'object',
      properties: {
        csdbDirs: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Folders to verify (default: S1000D_CSDB_DIR). Referenced objects are also searched here.',
        },
        include: {
          type: 'array',
          items: { type: 'string', enum: ['dm', 'pm', 'dml', 'ddn', 'imf', 'upf'] },
          description: 'Object kinds to verify (default: dm and pm).',
        },
        skip: skipParam,
        offset: {
          type: 'number',
          description: 'Index of the first object (default 0).',
          default: 0,
        },
        limit: {
          type: 'number',
          description: 'Objects per call (default 100, max 1000).',
          default: 100,
        },
        reportPath: {
          type: 'string',
          description:
            'If given, the full report (all details) is written to this JSON file; the response keeps only the statuses.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'suggest_fixes',
    description:
      'Verify one data module (same steps as verify_data_module) and return fix candidates for each finding: XSD errors (values and elements from the libxml2 message or from the XSD definitions), BREX violations (the rule\'s allowed values with their descriptions; remove / add for forbidden / missing; allowed notations), unresolved references (similar DMCs in the CSDB, the issue present in the CSDB, ICN files that differ only in the extension, similar ids) and, when "product" is given, applicability that cannot be decided because the product lacks a value (values from the ACT, CCT and PCT). Every candidate is decided by the server; each fix has a confidence (exact / several / none) and the source of its candidates. Does NOT apply any fix.',
    inputSchema: {
      type: 'object',
      properties: {
        path: pathParam,
        xml: xmlParam,
        csdbDirs: csdbDirsParam,
        skip: skipParam,
        product: {
          type: 'object',
          description:
            'The product to evaluate applicability against. If given, applicability that is undetermined because the product lacks a value is reported with candidate values. Omit it to skip applicability.',
          properties: {
            attributes: {
              type: 'object',
              additionalProperties: { type: 'string' },
              description: 'ACT productAttribute id → value.',
            },
            conditions: {
              type: 'object',
              additionalProperties: { type: 'string' },
              description: 'CCT cond id → value.',
            },
          },
          additionalProperties: false,
        },
        includeSpecificationReferences: {
          type: 'boolean',
          description:
            'Also list fixes for dmRef to the S1000D specification itself (modelIdentCode "S1000D"). They are never in a CSDB, are not errors and carry no candidate (default false; the count is always returned).',
          default: false,
        },
        maxFixes: {
          type: 'number',
          description: 'Cap on fixes returned (default 200). The total count is always reported.',
          default: 200,
        },
        maxCandidates: {
          type: 'number',
          description:
            'Cap on candidates per fix (default 20). A fix that was cut carries candidateCount.',
          default: 20,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_schemas',
    description:
      'Show which S1000D XML schema folders (xml_schema_flat/ containing brex.xsd) were found under S1000D_SPEC_DIR, with the issue read from brex.xsd and the schema names available. Use it to diagnose schema-not-found results.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];
