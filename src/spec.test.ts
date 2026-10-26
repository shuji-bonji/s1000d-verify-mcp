/**
 * 利用者が入手した S1000D の配布物に対するテスト（`S1000D_SPEC_TESTS=1` のときだけ）。
 * 配布物は再配布できない（DECISIONS D-03）。場所は `S1000D_SPEC_DIR`（既定: ../../specs/s1000d/issue-7）。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { buildServer } from './server.js';
import { clearCaches, disposeValidator } from './services/context.js';

const enabled = process.env.S1000D_SPEC_TESTS === '1';
const specDir = resolve(process.env.S1000D_SPEC_DIR ?? '../../specs/s1000d/issue-7');

function findBikeDir(dir: string): string | undefined {
  if (!existsSync(dir)) return undefined;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (/bike/i.test(e.name) && readdirSync(p).some((n) => /^DMC-.*\.XML$/i.test(n))) return p;
      const inner = findBikeDir(p);
      if (inner) return inner;
    }
  }
  return undefined;
}

let client: Client;
const bikeDir = findBikeDir(specDir);

async function call(name: string, args: Record<string, unknown>) {
  const res = await client.callTool({ name, arguments: args });
  const text =
    (res.content as { type: string; text: string }[]).find((c) => c.type === 'text')?.text ?? '{}';
  return { isError: res.isError === true, data: JSON.parse(text) as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

describe.skipIf(!enabled || !bikeDir)('S1000D 配布物（利用者が入手したもの）', () => {
  beforeAll(async () => {
    process.env.S1000D_SPEC_DIR = specDir;
    delete process.env.S1000D_CSDB_DIR;
    clearCaches();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await buildServer().connect(serverTransport);
    client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(clientTransport);
  });
  afterAll(async () => {
    await client.close();
    disposeValidator();
  });

  it('list_schemas が Issue 7 の xml_schema_flat/ を見つける', async () => {
    const r = await call('list_schemas', {});
    expect(r.data.schemaDirs.length).toBeGreaterThan(0);
    expect(r.data.schemaDirs[0].issue).toBe('7');
    expect(r.data.schemaDirs[0].schemaNames).toContain('descript');
  });

  it('verify_csdb: Bike Samples の DMC と PMC がすべて XSD に適合し、BREX の連鎖が解決する', async () => {
    const r = await call('verify_csdb', { csdbDirs: [bikeDir!], limit: 1000 });
    expect(r.isError).toBe(false);
    const t = r.data.totals;
    expect(t.objects).toBeGreaterThan(100);
    expect(t.verified).toBe(t.objects);
    expect(t.schemaInvalid).toBe(0);
    expect(t.schemaNotFound).toBe(0);
    expect(t.schemaValid).toBe(t.objects);
    expect(t.unreadable).toBe(0);
    // 既定 BREX への違反が出る DM がある（公式サンプルでも既定 BREX をすべて満たしてはいない。background.md）
    expect(t.brexViolations).toBeGreaterThan(0);
    expect(t.brexPassed + t.brexViolations + t.brexIncomplete).toBe(t.objects);
    expect(r.data.elapsedMs).toBeLessThan(120000);
  }, 180000);

  it('verify_data_module: 1 件の応答に検証状態と各工程の詳細が入る', async () => {
    const file = readdirSync(bikeDir!).find((n) => /^DMC-S1000DBIKE-.*-041A-A_.*\.XML$/i.test(n))!;
    const r = await call('verify_data_module', {
      path: join(bikeDir!, file),
      csdbDirs: [bikeDir!],
    });
    const v = r.data.verification;
    expect(v.schema.state).toBe('valid');
    expect(v.schema.issue).toBe('7');
    expect(v.brex.layers).toBeGreaterThanOrEqual(2);
    expect(v.brex.unresolved).toEqual([]);
    expect(r.data.references.checked).toBeGreaterThan(0);
    expect(r.data._notes.join(' ')).toContain('does not decide S1000D conformance');
  });

  it('check_references: 仕様書への dmRef は別枠になる', async () => {
    const brdoc = readdirSync(bikeDir!).find((n) => /-024A-D_.*\.XML$/i.test(n))!;
    const r = await call('check_references', { path: join(bikeDir!, brdoc), csdbDirs: [bikeDir!] });
    expect(r.data.references.specificationReferences.count).toBeGreaterThan(100);
    expect(r.data.references.specificationReferences.targets[0]).toMatch(/^S1000D-/);
    expect(r.data.references.unresolvedCount).toBeLessThan(
      r.data.references.specificationReferences.count,
    );
  });

  it('suggest_fixes: 仕様書への dmRef は既定で一覧に出さず、件数だけ返す。XSD 違反には公式 XSD の定義の候補が付く', async () => {
    const brdoc = readdirSync(bikeDir!).find((n) => /-024A-D_.*\.XML$/i.test(n))!;
    const r = await call('suggest_fixes', { path: join(bikeDir!, brdoc), csdbDirs: [bikeDir!] });
    expect(r.isError).toBe(false);
    expect(r.data.omitted.specificationReferences).toBeGreaterThan(100);
    expect(
      r.data.fixes.every((f: { source: string }) => f.source !== 'modelIdentCode S1000D'),
    ).toBe(true);

    const file = readdirSync(bikeDir!).find((n) => /^DMC-S1000DBIKE-.*-041A-A_.*\.XML$/i.test(n))!;
    const xml = readFileSync(join(bikeDir!, file), 'utf8').replace(
      /securityClassification="(\d\d)"/,
      'securityClassification="XX"',
    );
    const bad = await call('suggest_fixes', {
      xml,
      skip: ['brex', 'references'],
      maxCandidates: 5,
    });
    const sec = bad.data.fixes.find((f: { location?: { path: string } }) =>
      f.location?.path.endsWith('@securityClassification'),
    );
    expect(sec.source).toMatch(/xs:simpleType name="securityClassificationAttType"/);
    expect(sec.candidates).toHaveLength(5);
    expect(sec.candidateCount).toBeGreaterThan(5);
  });

  it('statSync で配布物の場所を確かめる（説明用）', () => {
    expect(statSync(bikeDir!).isDirectory()).toBe(true);
  });
});
