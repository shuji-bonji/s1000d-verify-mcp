/**
 * 設定。環境変数（と設定ファイル）とパッケージ情報をここに集める（s1000d-brex-mcp と同じ名前・同じ形）。
 */
import { createRequire } from 'node:module';
import {
  resolveStackConfig,
  specDirHowTo,
  type ResolvedStackConfig,
} from '@shuji-bonji/s1000d-core';

const require = createRequire(import.meta.url);
const packageJson = require('../package.json') as { name: string; version: string };

export const PACKAGE_INFO = {
  name: packageJson.name,
  version: packageJson.version,
} as const;

/** 環境変数の名前（無ければ設定ファイルの specDir / csdbDirs を読む） */
export const ENV = {
  /** 利用者が入手した S1000D の配布物を展開したフォルダー。XSD（xml_schema_flat/）と既定 BREX をここから探す */
  specDir: 'S1000D_SPEC_DIR',
  /** プロジェクトの CSDB（データモジュールが置かれたフォルダー）。区切り文字で複数指定できる */
  csdbDirs: 'S1000D_CSDB_DIR',
} as const;

/**
 * 配布物と CSDB の場所。環境変数 → 設定ファイル（既定 ~/.config/s1000d-stack/config.json）の順に読む（core の resolveStackConfig）。
 * Claude Desktop は plugin のサーバーに環境変数を渡さないので、設定ファイルでも決められるようにしている。
 * 呼ぶたびに読み直す（設定ファイルを直したらサーバーの再起動なしで効く）。
 */
export function stackConfig(): ResolvedStackConfig {
  return resolveStackConfig();
}

export function specDir(): string | undefined {
  return stackConfig().specDir;
}

export function csdbDirs(): string[] {
  return stackConfig().csdbDirs;
}

/** 配布物の場所が決まらないときの案内（環境変数か設定ファイルのどちらで決めるか） */
export function specDirHint(): string {
  return specDirHowTo(stackConfig());
}

/** 設定の注記（置き換えられずに渡った ${VAR}、読めない設定ファイル） */
export function stackConfigWarnings(): string[] {
  const c = stackConfig();
  return [
    ...c.warnings,
    ...(c.configError
      ? [`The config file ${c.configPath} could not be read: ${c.configError}`]
      : []),
  ];
}

/** 応答の大きさの上限 */
export const LIMITS = {
  /** XML 文字列を直接渡すときの上限（バイト） */
  maxInlineXmlBytes: 5 * 1024 * 1024,
  /** XSD 違反を 1 件の DM につき返す既定数 */
  defaultSchemaErrors: 100,
  maxSchemaErrors: 2000,
  /** BREX 違反を 1 層につき返す既定数 */
  maxViolationsPerLayer: 200,
  /** 未解決の参照を返す既定数 */
  defaultUnresolvedRefs: 200,
  /** verify_csdb が 1 回で扱う件数 */
  defaultBatch: 100,
  maxBatch: 1000,
} as const;
