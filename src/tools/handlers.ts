/**
 * ツールの実装。definitions.ts の name と 1 対 1 で対応する。
 * 検証の中身はすべて s1000d-core（verifyDataModule ほか）。ここは引数の解釈と応答の形だけ。
 */
import { writeFileSync } from 'node:fs';
import {
  collectReferences,
  defaultXmlEngine,
  findApplicTables,
  findUndeterminedApplicability,
  formatDmc,
  locateXsd,
  readDataModuleInfo,
  resolveBrexChain,
  resolveReferences,
  suggestFixes,
  verifyDataModule,
  type BrexCheckReport,
  type BrexDocument,
  type BrexResolver,
  type Fix,
  type Product,
  type Reference,
  type ReferenceReport,
  type SuggestFixesOptions,
  type VerifyOptions,
  type VerifyResult,
} from '@shuji-bonji/s1000d-core';
import { ENV, LIMITS, specDir } from '../config.js';
import {
  brexResolver,
  brexSearchDirs,
  configNotes,
  csdbIndex,
  csdbSearchDirs,
  loadXml,
  schemaDirs,
  schemaValidator,
  type ContextOptions,
} from '../services/context.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Args = Record<string, any>;
export type ToolHandler = (args: Args) => Promise<unknown>;

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}
function strArray(v: unknown): string[] | undefined {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined;
}
function int(v: unknown, def: number, min: number, max: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : def;
  return Math.min(max, Math.max(min, n));
}

const STANDARD_NOTES = [
  'This result does not decide S1000D conformance. "valid" and "passed" mean only that the XML schema and the machine-checkable BREX rules found no error; nonContextRules (manualChecks) and the project\'s human-readable business rules remain.',
  'Severity codes (brslNN) are project-defined and are passed through, not interpreted.',
];

/** core の VerifyOptions を、ツール引数と環境から組み立てる */
function verifyOptions(args: Args, ctx: ContextOptions, path?: string): VerifyOptions {
  const skip = new Set(strArray(args.skip) ?? []);
  const dirs = schemaDirs();
  return {
    path,
    schema: skip.has('schema') ? false : { validator: schemaValidator(), schemaDirs: dirs },
    brex: skip.has('brex') ? false : { resolver: brexResolver(ctx) },
    references: skip.has('references') ? false : { csdb: csdbIndex(ctx) },
  };
}

function trimBrex(report: BrexCheckReport | undefined, maxPerLayer: number) {
  if (!report) return undefined;
  return {
    target: report.target,
    passed: report.passed,
    unresolvedBrex: report.unresolved.map((u) => formatDmc(u.dmCode)),
    layers: report.layers.map((l) => ({
      brex: { dmCode: formatDmc(l.brex.dmCode), issueInfo: l.brex.issueInfo, title: l.brex.title },
      evaluatedRules: l.evaluatedRules,
      violationCount: l.violations.length,
      violations: l.violations.slice(0, maxPerLayer),
      skipped: l.skipped,
      manualChecks: l.manualChecks,
    })),
  };
}

function isSpecReference(r: Reference): boolean {
  return r.kind === 'dmRef' && r.ref.dmCode.modelIdentCode.toUpperCase() === 'S1000D';
}

function trimReferences(
  report: ReferenceReport | undefined,
  max: number,
  includeResolved: boolean,
) {
  if (!report) return undefined;
  const spec = report.unresolved.filter((u) => isSpecReference(u.reference));
  const others = report.unresolved.filter((u) => !isSpecReference(u.reference));
  const describe = (u: ReferenceReport['unresolved'][number]) => ({
    kind: u.reference.kind,
    target: u.target,
    reason: u.reason,
    message: u.message,
    context: u.reference.context,
    location: u.reference.location,
  });
  return {
    checked: report.checked,
    counts: report.counts,
    unresolvedCount: others.length,
    unresolved: others.slice(0, max).map(describe),
    /** 仕様書（モデル識別コード S1000D）への dmRef。CSDB には無いので別枠 */
    specificationReferences: {
      count: spec.length,
      targets: [...new Set(spec.map((u) => u.target))].slice(0, max),
    },
    resolved: includeResolved
      ? report.resolved.slice(0, max).map((r) => ({
          kind: r.reference.kind,
          target: r.target,
          path: r.path,
          foundIssueInfo: r.foundIssueInfo,
          issueMismatch: r.issueMismatch,
          notation: r.notation,
          externalApplic: r.externalApplic,
          context: r.reference.context,
        }))
      : undefined,
    issueMismatches: report.resolved.filter((r) => r.issueMismatch).length,
  };
}

function resultNotes(r: VerifyResult, ctx: ContextOptions): string[] {
  const notes = [...STANDARD_NOTES, ...configNotes(ctx)];
  if (r.status.schema.state === 'invalid') {
    notes.push(
      'The document has XML schema errors. BREX findings on such a document may be caused by, or hidden by, the schema errors.',
    );
  }
  if (r.status.brex.state === 'incomplete' || r.status.brex.unresolved.length > 0) {
    notes.push(
      `Some BREX in the chain were not found (${r.status.brex.unresolved.join(', ') || 'rules could not be evaluated'}). Searched: ${brexSearchDirs(ctx).join(', ') || '(none)'}. Treat the BREX result as incomplete.`,
    );
  }
  if (r.status.brex.manualChecks > 0) {
    notes.push(
      `${r.status.brex.manualChecks} nonContextRule(s) must be checked by a person (see brex.layers[].manualChecks).`,
    );
  }
  return notes;
}

async function verifyDataModuleTool(args: Args) {
  const path = str(args.path);
  const xml = loadXml({ path, xml: str(args.xml) }, LIMITS.maxInlineXmlBytes);
  const ctx: ContextOptions = { extraDirs: strArray(args.csdbDirs) };
  const r = await verifyDataModule(xml, verifyOptions(args, ctx, path));
  return {
    verification: r.status,
    schema: {
      xsdPath: r.schema.xsdPath,
      validator: r.schema.validator,
      errorCount: r.schema.errors.length,
      errors: r.schema.errors.slice(
        0,
        int(args.maxSchemaErrors, LIMITS.defaultSchemaErrors, 1, LIMITS.maxSchemaErrors),
      ),
      locate:
        r.schema.locate && !r.schema.locate.ok
          ? { reason: r.schema.locate.reason, message: r.schema.locate.message }
          : undefined,
    },
    brex: trimBrex(r.brex, int(args.maxViolationsPerLayer, LIMITS.maxViolationsPerLayer, 1, 5000)),
    references: trimReferences(
      r.references,
      int(args.maxUnresolvedRefs, LIMITS.defaultUnresolvedRefs, 1, 5000),
      false,
    ),
    _notes: resultNotes(r, ctx),
  };
}

async function validateSchemaTool(args: Args) {
  const path = str(args.path);
  const xml = loadXml({ path, xml: str(args.xml) }, LIMITS.maxInlineXmlBytes);
  const r = await verifyDataModule(xml, {
    path,
    schema: { validator: schemaValidator(), schemaDirs: schemaDirs(), issue: str(args.issue) },
  });
  const notes = [...configNotes({})];
  if (!r.status.wellFormed)
    notes.push('The document is not well-formed XML; schema validation was not run.');
  return {
    target: r.status.target,
    wellFormed: r.status.wellFormed,
    schema: {
      ...r.status.schema,
      errorCount: r.schema.errors.length,
      errors: r.schema.errors.slice(
        0,
        int(args.maxErrors, LIMITS.defaultSchemaErrors, 1, LIMITS.maxSchemaErrors),
      ),
      locate:
        r.schema.locate && !r.schema.locate.ok
          ? { reason: r.schema.locate.reason, message: r.schema.locate.message }
          : undefined,
    },
    _notes: notes,
  };
}

async function checkReferencesTool(args: Args) {
  const path = str(args.path);
  const xml = loadXml({ path, xml: str(args.xml) }, LIMITS.maxInlineXmlBytes);
  const ctx: ContextOptions = { extraDirs: strArray(args.csdbDirs) };
  const kinds = new Set(strArray(args.kinds) ?? []);
  const parsed = defaultXmlEngine.parse(xml);
  const info = readDataModuleInfo(xml);
  const collected = collectReferences(parsed.document);
  if (kinds.size > 0) collected.references = collected.references.filter((r) => kinds.has(r.kind));
  const report = resolveReferences(collected, { csdb: csdbIndex(ctx) });
  const max = int(args.maxItems, LIMITS.defaultUnresolvedRefs, 1, 5000);
  return {
    target: {
      dmCode: info.identAndStatus?.dmCode,
      schemaName: info.schemaName,
      issue: info.issue,
      path,
    },
    entityDeclarations: [...collected.entities.values()],
    references: trimReferences(report, max, args.includeResolved === true),
    searched: csdbSearchDirs(ctx),
    _notes: [
      ...configNotes(ctx),
      'Applicability is not evaluated here: applicRef only checks that the id exists (in this document, or via referencedApplicGroupRef/applicRef). Use s1000d-reader-mcp to evaluate applicability for a product.',
    ],
  };
}

async function verifyCsdbTool(args: Args) {
  const extraDirs = strArray(args.csdbDirs);
  const ctx: ContextOptions = { extraDirs };
  const index = csdbIndex(ctx);
  if (!index) {
    throw new Error(`No CSDB folders to verify. Pass "csdbDirs" or set ${ENV.csdbDirs}.`);
  }
  const include = new Set(strArray(args.include) ?? ['dm', 'pm']);
  const objects = index.objects.filter((o) => include.has(o.kind));
  const offset = int(args.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const limit = int(args.limit, LIMITS.defaultBatch, 1, LIMITS.maxBatch);
  const page = objects.slice(offset, offset + limit);
  const results: Array<{ path: string; verification?: VerifyResult['status']; error?: string }> =
    [];
  const full: Array<Record<string, unknown>> = [];
  const totals = {
    objects: objects.length,
    verified: 0,
    schemaValid: 0,
    schemaInvalid: 0,
    schemaNotFound: 0,
    brexPassed: 0,
    brexViolations: 0,
    brexIncomplete: 0,
    referencesUnresolved: 0,
    unreadable: 0,
  };
  const t0 = performance.now();
  for (const o of page) {
    try {
      const xml = loadXml({ path: o.path }, Number.MAX_SAFE_INTEGER);
      const r = await verifyDataModule(xml, verifyOptions(args, ctx, o.path));
      results.push({ path: o.path, verification: r.status });
      totals.verified++;
      if (r.status.schema.state === 'valid') totals.schemaValid++;
      else if (r.status.schema.state === 'invalid') totals.schemaInvalid++;
      else if (r.status.schema.state === 'schema-not-found') totals.schemaNotFound++;
      if (r.status.brex.state === 'passed') totals.brexPassed++;
      else if (r.status.brex.state === 'violations') totals.brexViolations++;
      else if (r.status.brex.state === 'incomplete') totals.brexIncomplete++;
      if (r.status.references.state === 'unresolved') totals.referencesUnresolved++;
      if (args.reportPath) {
        full.push({
          path: o.path,
          verification: r.status,
          schemaErrors: r.schema.errors,
          brex: trimBrex(r.brex, 5000),
          references: trimReferences(r.references, 5000, true),
        });
      }
    } catch (e) {
      totals.unreadable++;
      results.push({ path: o.path, error: e instanceof Error ? e.message : String(e) });
    }
  }
  const elapsedMs = Math.round(performance.now() - t0);
  let reportPath: string | undefined;
  if (args.reportPath) {
    reportPath = String(args.reportPath);
    writeFileSync(
      reportPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          searched: csdbSearchDirs(ctx),
          totals,
          results: full,
        },
        null,
        2,
      ),
    );
  }
  const notes = [...STANDARD_NOTES, ...configNotes(ctx)];
  if (offset + page.length < objects.length) {
    notes.push(
      `Only ${page.length} of ${objects.length} objects were verified in this call. Continue with offset=${offset + page.length}.`,
    );
  }
  return {
    searched: csdbSearchDirs(ctx),
    page: { offset, returned: page.length, total: objects.length },
    totals,
    elapsedMs,
    reportPath,
    results,
    _notes: notes,
  };
}

/** 1 回の呼び出しの中で同じ BREX を 2 度読まないための解決器（検証と修正提案の両方で連鎖をたどるため） */
function memoResolver(inner: BrexResolver): BrexResolver {
  const cache = new Map<string, Promise<BrexDocument | undefined>>();
  return (ref) => {
    const key = formatDmc(ref.dmCode);
    let hit = cache.get(key);
    if (!hit) {
      hit = Promise.resolve(inner(ref));
      cache.set(key, hit);
    }
    return hit;
  };
}

function stringRecord(v: unknown): Record<string, string> {
  if (!v || typeof v !== 'object') return {};
  return Object.fromEntries(
    Object.entries(v as Record<string, unknown>).filter(
      (e): e is [string, string] => typeof e[1] === 'string',
    ),
  );
}

function isSpecificationFix(f: Fix): boolean {
  return f.kind === 'reference' && f.source === 'modelIdentCode S1000D';
}

async function suggestFixesTool(args: Args) {
  const path = str(args.path);
  const xml = loadXml({ path, xml: str(args.xml) }, LIMITS.maxInlineXmlBytes);
  const ctx: ContextOptions = { extraDirs: strArray(args.csdbDirs) };
  const resolver = memoResolver(brexResolver(ctx));
  const options = verifyOptions(args, ctx, path);
  if (options.brex) options.brex = { resolver };
  const r = await verifyDataModule(xml, options);
  const notes = resultNotes(r, ctx);
  if (!r.status.wellFormed) {
    return {
      verification: r.status,
      fixCount: 0,
      fixes: [],
      _notes: [...notes, 'The document is not well-formed XML; fix the XML syntax first.'],
    };
  }
  const csdb = csdbIndex(ctx);

  let brexLayers: BrexDocument[] | undefined;
  if (r.brex) {
    brexLayers = (await resolveBrexChain(r.info?.identAndStatus?.brexDmRef, resolver)).layers;
  }

  let applicability: SuggestFixesOptions['applicability'];
  let applicabilityInfo: Record<string, unknown> = { checked: false };
  if (args.product && typeof args.product === 'object') {
    const product: Product = {
      attributes: stringRecord(args.product.attributes),
      conditions: stringRecord(args.product.conditions),
    };
    const tables = findApplicTables(xml, csdb);
    const findings = findUndeterminedApplicability(xml, product);
    applicability = {
      findings,
      act: tables.act?.act,
      cct: tables.cct?.cct,
      pct: tables.pct?.pct,
    };
    applicabilityInfo = {
      checked: true,
      undetermined: findings.length,
      tables: { act: tables.act?.path, cct: tables.cct?.path, pct: tables.pct?.path },
      missingTables: tables.missing,
    };
  }

  const all = suggestFixes(r, { xml, csdb, brexLayers, applicability });
  const spec = all.filter(isSpecificationFix);
  const listed =
    args.includeSpecificationReferences === true ? all : all.filter((f) => !isSpecificationFix(f));
  const maxFixes = int(args.maxFixes, 200, 1, 5000);
  const maxCandidates = int(args.maxCandidates, 20, 1, 1000);
  const fixes = listed.slice(0, maxFixes).map((f) =>
    f.candidates.length > maxCandidates
      ? {
          ...f,
          candidates: f.candidates.slice(0, maxCandidates),
          candidateCount: f.candidates.length,
        }
      : f,
  );
  const byConfidence = { exact: 0, several: 0, none: 0 };
  for (const f of listed) byConfidence[f.confidence]++;

  if (listed.length > fixes.length)
    notes.push(
      `Only ${fixes.length} of ${listed.length} fixes are listed. Raise maxFixes to see more.`,
    );
  if (spec.length > 0 && args.includeSpecificationReferences !== true)
    notes.push(
      `${spec.length} dmRef(s) to the S1000D specification itself are not listed; they are not errors.`,
    );
  notes.push(
    'Choose only among the candidates. When confidence is "none", ask the user. Candidates with valueForm "range" or "pattern" are constraints; ask the user for a value that satisfies them.',
  );
  return {
    verification: r.status,
    fixCount: listed.length,
    byConfidence,
    fixes,
    omitted: {
      specificationReferences: args.includeSpecificationReferences === true ? 0 : spec.length,
    },
    applicability: applicabilityInfo,
    _notes: notes,
  };
}

async function listSchemasTool() {
  const spec = specDir();
  const dirs = schemaDirs();
  return {
    specDir: spec,
    schemaDirs: dirs.map((d) => ({
      dir: d.dir,
      issue: d.issue,
      xsdCount: d.xsdCount,
      schemaNames: d.schemaNames,
    })),
    example:
      dirs.length > 0
        ? locateXsd('http://www.s1000d.org/S1000D_7/xml_schema_flat/descript.xsd', dirs)
        : undefined,
    _notes: [
      ...configNotes({}),
      'The XSD for a document is chosen by the file name in its xsi:noNamespaceSchemaLocation; when several folders exist, by the issue read from brex.xsd matching the S1000D_<issue> part of that URL.',
    ],
  };
}

export const toolHandlers: Record<string, ToolHandler> = {
  verify_data_module: verifyDataModuleTool,
  validate_schema: validateSchemaTool,
  check_references: checkReferencesTool,
  verify_csdb: verifyCsdbTool,
  suggest_fixes: suggestFixesTool,
  list_schemas: listSchemasTool,
};
