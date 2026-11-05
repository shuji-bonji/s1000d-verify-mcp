/**
 * 呼び出し側が直せる、想定内の失敗。server.ts で isError にせず、s1000d-writer-mcp と同じ形
 * `{"error": {"code", "path", "detail"}}` で返す。
 *
 * - code: 分類（`file-not-found` / `no-csdb` / `input-error`）
 * - path: 直す引数の場所（`/path`、`/csdbDirs` など。ファイルのパスではない）
 * - detail: 人が読む説明
 */
export type ToolErrorCode = 'file-not-found' | 'no-csdb' | 'input-error';

export class ToolInputError extends Error {
  constructor(
    readonly code: ToolErrorCode,
    readonly path: string,
    readonly detail: string,
  ) {
    super(detail);
    this.name = 'ToolInputError';
  }
}
