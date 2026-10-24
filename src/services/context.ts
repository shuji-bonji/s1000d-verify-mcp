/**
 * 検証に使うもの（XSD の場所、検証器、CSDB の索引、BREX の解決器）をまとめて作る。
 *
 * - XSD の検証器（Libxml2SchemaValidator）はプロセスで 1 つ。XSD ごとのコンパイル結果を使い回す（D-15）
 * - `xml_schema_flat/` の探索結果と CSDB の索引は、フォルダーの組み合わせごとに覚える
 * - 探索そのものは s1000d-core が行う。ここは環境変数とツール引数の解釈だけ
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import {
  CsdbIndex,
  createDirectoryBrexResolver,
  findSchemaDirs,
  type BrexResolver,
  type SchemaDir,
} from '@shuji-bonji/s1000d-core';
import { Libxml2SchemaValidator } from '@shuji-bonji/s1000d-core/xsd-libxml2';
import { ENV, csdbDirs, specDir } from '../config.js';

export interface ContextOptions {
  /** ツール引数で追加されたフォルダー */
  extraDirs?: string[];
}

function existingDirs(dirs: string[]): string[] {
  return [...new Set(dirs.filter((d) => existsSync(d) && statSync(d).isDirectory()))];
}

/** CSDB として探すフォルダー（優先順: ツール引数 → S1000D_CSDB_DIR） */
export function csdbSearchDirs(options: ContextOptions = {}): string[] {
  return existingDirs([...(options.extraDirs ?? []), ...csdbDirs()]);
}

/** BREX を探すフォルダー（CSDB ＋ 配布物） */
export function brexSearchDirs(options: ContextOptions = {}): string[] {
  const spec = specDir();
  return existingDirs([...csdbSearchDirs(options), ...(spec ? [spec] : [])]);
}

let validator: Libxml2SchemaValidator | undefined;
export function schemaValidator(): Libxml2SchemaValidator {
  validator ??= new Libxml2SchemaValidator();
  return validator;
}
export function disposeValidator(): void {
  validator?.dispose();
  validator = undefined;
}

const schemaDirCache = new Map<string, SchemaDir[]>();
/** `S1000D_SPEC_DIR` の下の xml_schema_flat/。未設定なら空 */
export function schemaDirs(): SchemaDir[] {
  const spec = specDir();
  if (!spec || !existsSync(spec)) return [];
  let dirs = schemaDirCache.get(spec);
  if (!dirs) {
    // 配布物のデータ辞書（data_dictionary_7/Files/xml_schema_flat/）にも XSD の写しがあるが、
    // そちらは xml.xsd を http://www.w3.org/2001/xml.xsd の絶対 URL で import していて、libxml2 が
    // ネットワークに出ようとして失敗する。「XML Schema Package」側だけを使う（core 0.2.1 でも除外する予定）
    dirs = findSchemaDirs([spec]).filter(
      (d) => !/(^|[\\/])data_dictionary[^\\/]*[\\/]/i.test(d.dir),
    );
    schemaDirCache.set(spec, dirs);
  }
  return dirs;
}

const indexCache = new Map<string, CsdbIndex>();
/** CSDB の索引。フォルダーの組み合わせごとに 1 回だけ作る */
export function csdbIndex(options: ContextOptions = {}): CsdbIndex | undefined {
  const dirs = csdbSearchDirs(options);
  if (dirs.length === 0) return undefined;
  const key = dirs.join('\0');
  let index = indexCache.get(key);
  if (!index) {
    index = CsdbIndex.fromDirs(dirs);
    indexCache.set(key, index);
  }
  return index;
}
/** テスト用。フォルダーの中身が変わったときに呼ぶ */
export function clearCaches(): void {
  indexCache.clear();
  schemaDirCache.clear();
}

export function brexResolver(options: ContextOptions = {}): BrexResolver {
  return createDirectoryBrexResolver(brexSearchDirs(options));
}

/** 設定が無いときに応答へ添える案内 */
export function configNotes(options: ContextOptions = {}): string[] {
  const notes: string[] = [];
  if (!specDir()) {
    notes.push(
      `${ENV.specDir} is not set: XSD validation is reported as schema-not-found and the S1000D default BREX cannot be found. Set it to the folder where the S1000D distribution is extracted.`,
    );
  } else if (schemaDirs().length === 0) {
    notes.push(
      `No xml_schema_flat/ folder (containing brex.xsd) was found under ${ENV.specDir}=${specDir()}. Extract the "XML Schema Package" zip inside it.`,
    );
  }
  if (csdbSearchDirs(options).length === 0) {
    notes.push(
      `No CSDB folders: set ${ENV.csdbDirs} or pass "csdbDirs". References to other data modules, publication modules and ICN files are reported as no-csdb.`,
    );
  }
  return notes;
}

/** データモジュールの入力（パスか XML 文字列）を XML 文字列にする */
export function loadXml(input: { path?: string; xml?: string }, maxBytes: number): string {
  if (input.xml !== undefined && input.xml.trim() !== '') {
    if (Buffer.byteLength(input.xml, 'utf8') > maxBytes)
      throw new Error(`Inline XML exceeds ${maxBytes} bytes`);
    return input.xml;
  }
  if (input.path !== undefined && input.path.trim() !== '') {
    if (!existsSync(input.path)) throw new Error(`File not found: ${input.path}`);
    return readFileSync(input.path, 'utf8');
  }
  throw new Error('Either "path" or "xml" is required');
}
