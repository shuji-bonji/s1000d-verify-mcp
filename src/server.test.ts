/**
 * サーバを InMemoryTransport で叩き、ツール定義とハンドラの対応、各ツールの応答の形を確かめる。
 * テストデータは自作（券売機）と、テストの中で作る小さな XSD。配布物は使わない。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { buildServer } from './server.js';
import { clearCaches, disposeValidator } from './services/context.js';
import { tools } from './tools/definitions.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures');
const dm = join(fixtures, 'DMC-KENBAIKI-A-10-20-00-00A-040A-D_002-01_JA-JP.XML');

let client: Client;
let specRoot: string;

async function call(name: string, args: Record<string, unknown>) {
  const res = await client.callTool({ name, arguments: args });
  const text =
    (res.content as { type: string; text: string }[]).find((c) => c.type === 'text')?.text ?? '{}';
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text);
  } catch {
    data = { error: text };
  }
  return { isError: res.isError === true, data: data as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** 自作の最小 XSD（S1000D のものではない）。note.xsd が common.xsd を import する */
const COMMON_XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:test:common" xmlns="urn:test:common">
  <xs:simpleType name="shortText"><xs:restriction base="xs:string"><xs:maxLength value="20"/></xs:restriction></xs:simpleType>
</xs:schema>`;
const NOTE_XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:c="urn:test:common">
  <xs:import namespace="urn:test:common" schemaLocation="common.xsd"/>
  <xs:element name="note"><xs:complexType><xs:sequence>
    <xs:element name="title" type="c:shortText"/><xs:element name="year" type="xs:gYear"/>
  </xs:sequence></xs:complexType></xs:element>
</xs:schema>`;
const BREX_XSD_STUB = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:annotation id="version"><xs:documentation>Issue number: 7</xs:documentation></xs:annotation><xs:element name="dmodule"/></xs:schema>`;
const noteXml = (year: string) =>
  `<?xml version="1.0"?><note xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://example.test/S1000D_7/xml_schema_flat/note.xsd">\n<title>Hello</title>\n<year>${year}</year>\n</note>`;

beforeAll(async () => {
  delete process.env.S1000D_SPEC_DIR;
  delete process.env.S1000D_CSDB_DIR;
  // 開発機の ~/.config/s1000d-stack/config.json を読まないよう、存在しない場所に向ける
  process.env.S1000D_CONFIG = join(tmpdir(), 's1000d-no-such-config.json');
  specRoot = mkdtempSync(join(tmpdir(), 's1000d-verify-mcp-'));
  const flat = join(specRoot, 'schema package', 'xml_schema_flat');
  mkdirSync(flat, { recursive: true });
  writeFileSync(join(flat, 'brex.xsd'), BREX_XSD_STUB);
  writeFileSync(join(flat, 'common.xsd'), COMMON_XSD);
  writeFileSync(join(flat, 'note.xsd'), NOTE_XSD);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer();
  await server.connect(serverTransport);
  client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client.close();
  disposeValidator();
  rmSync(specRoot, { recursive: true, force: true });
});

describe('server', () => {
  it('instructions で「しないこと」を宣言している', () => {
    const text = client.getInstructions() ?? '';
    expect(text).toContain('does NOT');
    expect(text).toContain('conformance');
    expect(text).toContain('S1000D_SPEC_DIR');
    expect(text).toContain('schema-not-found');
  });

  it('定義したツールがすべて登録されている', async () => {
    const listed = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(listed).toEqual(tools.map((t) => t.name).sort());
  });

  it('未知の引数は拒否される', async () => {
    const r = await call('list_schemas', { bogus: 1 });
    expect(r.isError).toBe(true);
  });
});

describe('S1000D_SPEC_DIR が無いとき', () => {
  it('verify_data_module は schema-not-found を返し、BREX は自作フィクスチャの連鎖で照合する', async () => {
    delete process.env.S1000D_SPEC_DIR;
    clearCaches();
    const r = await call('verify_data_module', { path: dm, csdbDirs: [fixtures] });
    expect(r.isError).toBe(false);
    const v = r.data.verification;
    expect(v.wellFormed).toBe(true);
    expect(v.target.schemaName).toBe('descript');
    expect(v.schema.state).toBe('schema-not-found');
    expect(v.schema.reason).toMatch(/no-schema-dir/);
    expect(v.brex.layers).toBe(2); // KENBAIKI → KBWORKS（自己参照で終端）
    expect(['passed', 'violations']).toContain(v.brex.state);
    expect(v.brex.unresolved).toEqual([]);
    expect(v.references.state).toBe('unresolved'); // ICN のファイルはフィクスチャに無い
    expect(r.data.brex.layers).toHaveLength(2);
    expect(
      r.data.references.unresolved.some((u: { reason: string }) => u.reason === 'file-not-found'),
    ).toBe(true);
    expect(r.data._notes.join(' ')).toContain('S1000D_SPEC_DIR is not set');
  });

  it('skip で省いた工程は not-run', async () => {
    const r = await call('verify_data_module', {
      path: dm,
      skip: ['schema', 'brex', 'references'],
    });
    expect(r.data.verification.schema.state).toBe('not-run');
    expect(r.data.verification.brex.state).toBe('not-run');
    expect(r.data.verification.references.state).toBe('not-run');
    expect(r.data.brex).toBeUndefined();
  });

  it('list_schemas は未設定を案内する', async () => {
    const r = await call('list_schemas', {});
    expect(r.data.schemaDirs).toEqual([]);
    expect(r.data._notes.join(' ')).toContain('S1000D_SPEC_DIR is not set');
  });

  it('check_references は CSDB 無しだと no-csdb、CSDB ありだと解決する', async () => {
    const none = await call('check_references', { path: dm });
    expect(
      none.data.references.unresolved.every((u: { reason: string }) => u.reason === 'no-csdb'),
    ).toBe(true);
    const some = await call('check_references', {
      path: dm,
      csdbDirs: [fixtures],
      includeResolved: true,
    });
    expect(some.data.entityDeclarations).toHaveLength(1);
    expect(some.data.references.resolved.some((x: { kind: string }) => x.kind === 'dmRef')).toBe(
      true,
    ); // brexDmRef が解決
    expect(
      some.data.references.unresolved.map(
        (u: { kind: string; reason: string }) => `${u.kind}:${u.reason}`,
      ),
    ).toEqual(['icn:file-not-found']);
    expect(some.data.searched).toEqual([fixtures]);
  });

  it('verify_csdb はフィクスチャの 3 件を検証し集計する', async () => {
    const r = await call('verify_csdb', { csdbDirs: [fixtures] });
    expect(r.isError).toBe(false);
    expect(r.data.page).toEqual({ offset: 0, returned: 3, total: 3 });
    expect(r.data.totals.verified).toBe(3);
    expect(r.data.totals.schemaNotFound).toBe(3);
    expect(r.data.results.every((x: { verification?: unknown }) => x.verification)).toBe(true);
    const paged = await call('verify_csdb', { csdbDirs: [fixtures], limit: 2 });
    expect(paged.data.page.returned).toBe(2);
    expect(paged.data._notes.join(' ')).toContain('offset=2');
  });

  it('suggest_fixes は検証状態と修正提案を返す（ICN は拡張子違いのファイルを候補にする）', async () => {
    const r = await call('suggest_fixes', { path: dm, csdbDirs: [fixtures] });
    expect(r.isError).toBe(false);
    expect(r.data.verification.target.schemaName).toBe('descript');
    expect(r.data.fixCount).toBe(r.data.fixes.length);
    const icn = r.data.fixes.find((f: { kind: string; problem: string }) =>
      f.problem.includes('declared for'),
    );
    expect(icn).toMatchObject({ kind: 'reference', source: 'CsdbIndex and DOCTYPE' });
    expect(['exact', 'several', 'none']).toContain(icn.confidence);
    expect(r.data.byConfidence.exact + r.data.byConfidence.several + r.data.byConfidence.none).toBe(
      r.data.fixCount,
    );
    expect(r.data.applicability).toEqual({ checked: false });
    expect(r.data._notes.join(' ')).toContain('Choose only among the candidates');
  });

  it('suggest_fixes は BREX の値の違反にルールの許可値と説明文を付ける', async () => {
    const xml = readFileSync(dm, 'utf8').replace(/countryIsoCode="JP"/, 'countryIsoCode="US"');
    const r = await call('suggest_fixes', { xml, csdbDirs: [fixtures], skip: ['references'] });
    // 上位の BREX（KBWORKS）の国コードのルール
    const value = r.data.fixes.find(
      (f: { kind: string; source: string }) =>
        f.kind === 'brex-value' && f.source.startsWith('BREX KBWORKS-'),
    );
    expect(value).toBeDefined();
    expect(value.candidates[0]).toMatchObject({ action: 'replace', value: 'JP' });
    expect(value.candidates[0].description).not.toBe('a value allowed by the BREX rule');
  });

  it('suggest_fixes に product を渡すと、値の足りない適用性を報告する（ACT が無ければ候補なし）', async () => {
    const xml = readFileSync(dm, 'utf8').replace(
      /<applic>[\s\S]*?<\/applic>/,
      '<applic><displayText><simplePara>MV-50</simplePara></displayText><assert applicPropertyIdent="model" applicPropertyType="prodattr" applicPropertyValues="MV-50"/></applic>',
    );
    const r = await call('suggest_fixes', {
      xml,
      skip: ['brex', 'references'],
      product: { attributes: {}, conditions: {} },
    });
    expect(r.data.applicability.checked).toBe(true);
    expect(r.data.applicability.undetermined).toBe(1);
    const a = r.data.fixes.find((f: { kind: string }) => f.kind === 'applicability');
    expect(a).toMatchObject({ confidence: 'none', candidates: [] });
    expect(a.note).toContain('ask');
  });

  it('reconcile_dml は DML の行を CSDB と照合し、無い行と版違いの行だけを返す', async () => {
    const r = await call('reconcile_dml', {
      path: join(fixtures, 'DML-KENBAIKI-K0001-S-2026-00001_001-00.XML'),
      csdbDirs: [fixtures],
    });
    expect(r.isError).toBe(false);
    expect(r.data.listCount).toBe(1);
    const dml = r.data.lists[0];
    expect(dml.kind).toBe('dml');
    expect(dml.dmlCode).toBe('KENBAIKI-K0001-S-2026-00001');
    expect(dml.issueDate).toBe('2026-10-28');
    expect(dml.brexDmRef).toBe('KENBAIKI-A-00-00-00-00A-022A-D');
    expect(dml.entryCount).toBe(3);
    expect(dml.counts).toEqual({ found: 1, 'issue-mismatch': 1, 'not-found': 1, 'not-checked': 0 });
    // 既定では found は省く
    expect(dml.entries.map((e: { state: string }) => e.state)).toEqual([
      'issue-mismatch',
      'not-found',
    ]);
    expect(dml.entries[0].target).toBe('KENBAIKI-A-00-00-00-00A-022A-D');
    expect(dml.entries[0].listedIssueInfo).toEqual({ issueNumber: '002', inWork: '00' });
    expect(dml.entries[0].foundIssueInfo).toEqual({ issueNumber: '001', inWork: '00' });
    expect(dml.entries[1].dmlEntryType).toBe('n');
    // KBWORKS の BREX は別のモデルなので notListed に出ない
    expect(dml.notListedCount).toBe(0);
    const all = await call('reconcile_dml', {
      path: join(fixtures, 'DML-KENBAIKI-K0001-S-2026-00001_001-00.XML'),
      csdbDirs: [fixtures],
      includeFound: true,
    });
    expect(all.data.lists[0].entries).toHaveLength(3);
    expect(all.data.lists[0].entries[0].title).toBe('指定席券売機 - 説明');
  });
  it('reconcile_dml は DDN も受け取り、省略時は CSDB の DML・DDN をすべて照合する', async () => {
    const ddn = await call('reconcile_dml', {
      path: join(fixtures, 'DDN-KENBAIKI-K0001-K0002-2026-00001.XML'),
      csdbDirs: [fixtures],
    });
    expect(ddn.isError).toBe(false);
    const d = ddn.data.lists[0];
    expect(d.kind).toBe('ddn');
    expect(d.ddnCode).toBe('KENBAIKI-K0001-K0002-2026-00001');
    expect(d.itemCount).toBe(4);
    expect(d.counts).toEqual({ found: 2, 'issue-mismatch': 1, 'not-found': 1, 'not-checked': 0 });
    expect(d.items.map((i: { state: string; fileName: string }) => [i.state, i.fileName])).toEqual([
      ['issue-mismatch', 'DMC-KENBAIKI-A-00-00-00-00A-022A-D_002-00_JA-JP.XML'],
      ['not-found', 'readme.txt'],
    ]);
    const both = await call('reconcile_dml', { csdbDirs: [fixtures] });
    expect(both.isError).toBe(false);
    expect(both.data.listCount).toBe(2);
    expect(both.data.lists.map((l: { kind: string }) => l.kind).sort()).toEqual(['ddn', 'dml']);
    const notDml = await call('reconcile_dml', { path: dm, csdbDirs: [fixtures] });
    expect(notDml.isError).toBe(true);
    expect(notDml.data.error).toMatch(/Not a DML or DDN/);
  });
  it('CSDB も指定も無い verify_csdb はエラー', async () => {
    const r = await call('verify_csdb', {});
    expect(r.isError).toBe(true);
    expect(r.data.error).toContain('S1000D_CSDB_DIR');
  });
});

describe('S1000D_SPEC_DIR に自作の xml_schema_flat/ があるとき', () => {
  beforeAll(() => {
    process.env.S1000D_SPEC_DIR = specRoot;
    clearCaches();
  });
  afterAll(() => {
    delete process.env.S1000D_SPEC_DIR;
    clearCaches();
  });

  it('list_schemas が見つけた XSD と版を返す', async () => {
    const r = await call('list_schemas', {});
    expect(r.data.schemaDirs).toHaveLength(1);
    expect(r.data.schemaDirs[0]).toMatchObject({
      issue: '7',
      xsdCount: 3,
      schemaNames: ['brex', 'common', 'note'],
    });
  });

  it('validate_schema が valid / invalid を行番号付きで返す', async () => {
    const ok = await call('validate_schema', { xml: noteXml('2026') });
    expect(ok.data.schema.state).toBe('valid');
    expect(ok.data.schema.validator).toMatch(/^libxml2-wasm/);
    const bad = await call('validate_schema', { xml: noteXml('abcd') });
    expect(bad.data.schema.state).toBe('invalid');
    expect(bad.data.schema.errorCount).toBe(1);
    expect(bad.data.schema.errors[0].line).toBe(3);
    const broken = await call('validate_schema', { xml: '<note><title>' });
    expect(broken.data.wellFormed).toBe(false);
    expect(broken.data.schema.state).toBe('not-run');
  });

  it('XSD の無い種類（descript）は xsd-not-found', async () => {
    const r = await call('verify_data_module', { path: dm, skip: ['brex', 'references'] });
    expect(r.data.verification.schema.state).toBe('schema-not-found');
    expect(r.data.schema.locate.reason).toBe('xsd-not-found');
  });

  it('suggest_fixes は XSD 違反に XSD の定義から候補や注記を付ける', async () => {
    const r = await call('suggest_fixes', { xml: noteXml('abcd'), skip: ['brex', 'references'] });
    expect(r.data.verification.schema.state).toBe('invalid');
    const f = r.data.fixes.find((x: { kind: string }) => x.kind === 'schema');
    expect(f.location.line).toBe(3);
    expect(f.problem).toContain("'abcd'");
  });

  it('XML 文字列が大きすぎるとエラー', async () => {
    const r = await call('validate_schema', { xml: 'x'.repeat(5 * 1024 * 1024 + 1) });
    expect(r.isError).toBe(true);
  });
});

describe('設定ファイル（~/.config/s1000d-stack/config.json の代わり）', () => {
  let configPath: string;
  beforeAll(() => {
    configPath = join(specRoot, 'config.json');
    writeFileSync(configPath, JSON.stringify({ specDir: specRoot, csdbDirs: [fixtures] }));
    process.env.S1000D_CONFIG = configPath;
    clearCaches();
  });
  afterAll(() => {
    process.env.S1000D_CONFIG = join(tmpdir(), 's1000d-no-such-config.json');
    delete process.env.S1000D_SPEC_DIR;
    clearCaches();
  });

  it('S1000D_SPEC_DIR が無ければ設定ファイルの specDir と csdbDirs を使う', async () => {
    delete process.env.S1000D_SPEC_DIR;
    const r = await call('list_schemas', {});
    expect(r.data.specDir).toBe(specRoot);
    expect(r.data.schemaDirs).toHaveLength(1);
    const refs = await call('check_references', { path: dm });
    expect(refs.data.searched).toEqual([fixtures]);
  });

  it('置き換えられずに渡った ${S1000D_SPEC_DIR} は使わず、設定ファイルに戻って注記する', async () => {
    process.env.S1000D_SPEC_DIR = '${S1000D_SPEC_DIR}';
    clearCaches();
    const r = await call('list_schemas', {});
    expect(r.data.specDir).toBe(specRoot);
    expect(r.data._notes.join(' ')).toContain('unexpanded');
  });
});
