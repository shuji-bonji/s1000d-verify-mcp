# Changelog

## 0.6.0 (2026-10-28)

### 追加

- 7 本目のツール `reconcile_dml`（段階 2.5 の作業 5、D-19）。DML か DDN（`path` / `xml`。省くと CSDB の DML・DDN をすべて）を CSDB と照合し、行ごとに `found` / `issue-mismatch` / `not-found` / `not-checked` と、DML に載っていない DM・PM（`notListed`）を返します。既定では `found` の行を省き（`includeFound: true` で含める）、`maxItems`（既定 200）で件数を抑えます。処理は core 0.6.0 の `readDml` / `readDdn` / `reconcileDml` / `reconcileDdn`。`instructions` と README に、DML の値を解釈しないこと、中身の検証は `verify_csdb` で行うことを書きました。
- `verify_csdb` の `include` に `dme`（拡張 DMC のデータモジュール）を足しました。

### 変更

- 依存を core `^0.6.0` に上げました。

## 0.5.0 (2026-10-27)

### 追加

- Streamable HTTP での起動（`--http`。`--host` / `--port` / `--path` / `--allowed-host` / `--allowed-origin`。段階 2.5 の作業 4、D-19）。MCP SDK v2 の `createMcpHandler` を `node:http` に載せました。`GET /healthz` は名前と版を返します。loopback に束縛したときは `Host` と `Origin` を localhost 系に限り、それ以外では検査しません。認証・権限・マルチテナントは持ちません（製品側の責務）。既定の stdio は変わりません。

## 0.4.0 (2026-10-27)

### 変更

- 依存を core `^0.5.0` に上げ、`verify_csdb` が CSDB の各オブジェクトを `readFileSync(o.path)` ではなく索引の `read()`（core 0.5.0 の `CsdbSource`）から読むようにしました。既定のフォルダー実装では結果は変わりません。製品側が `CsdbSource` を差し込む土台です（段階 2.5 の作業 3）。ツール引数の `path` と `xml` の読み取りはこれまでどおりです。

## 0.3.0 (2026-10-27)

### 追加

- `S1000D_SPEC_DIR` / `S1000D_CSDB_DIR` が無いときに、設定ファイル `~/.config/s1000d-stack/config.json`（`XDG_CONFIG_HOME` に従う、`S1000D_CONFIG` で変更可）の `specDir` / `csdbDirs` を読むようにしました（core の `resolveStackConfig`）。Claude Desktop が plugin で入れたサーバーに環境変数を渡さず、plugin の `env` の `${VAR}` も置き換えないためです。置き換えられずに渡った `${VAR}` は使わず、応答の `_notes` に理由を書きます。配布物の場所が決まらないときの案内にも、設定ファイルの場所を出します。
- `instructions` と README（英語・日本語）に設定ファイルの説明を足しました。

**core 0.4.0（`resolveStackConfig`）の公開後に依存を上げてから公開します。**

## 0.2.0 (2026-10-27)

段階 2.5 の作業 2（D-19、design/agent-platform.md「修正提案の設計」）。依存を `@shuji-bonji/s1000d-core` `^0.3.0` に上げました。

### 変更

- core 0.3.0 で BREX の NOTATION の照合が直りました。除外（`allowedNotationFlag="0"`）だけの `notationRuleList` を持つ BREX に照合すると、これまで使われているすべての NOTATION が違反になっていましたが、0.2.0 からは除外されたものだけが違反になります（Bike Samples では NOTATION の違反が 36 件 → 0 件）。`verify_data_module` と `verify_csdb` の BREX の違反の件数が変わります。

### 追加

- ツール `suggest_fixes`: `verify_data_module` と同じ検証を行い、core の `suggestFixes` で違反ごとの修正候補（`Fix`）を返します。応答は `verification`・`fixCount`・`byConfidence`・`fixes`・`omitted`・`applicability`。仕様書の章への `dmRef` は既定で一覧に出さず件数だけを返し（`includeSpecificationReferences` で出せる）、`maxFixes`・`maxCandidates` で量を絞れます（切った修正には `candidateCount`）。`product` を渡すと、製品の値が足りず判定できない適用性に ACT・CCT・PCT の値を候補として付けます。BREX の連鎖は 1 回の呼び出しの中で 1 度だけ読みます。
- `instructions` に「候補の外の値を提案しない」「`confidence: none` なら利用者に聞く」「`range` / `pattern` は値ではなく制約」「`provide` は製品の入力で文書の変更ではない」「修正の適用はしない」を追加。

## 0.1.1 (2026-10-27)

MCP Registry と claude-plugins marketplace に載せるための版。ツールと応答は 0.1.0 から変わっていません。

### 追加

- `package.json` に `mcpName`（`io.github.shuji-bonji/s1000d-verify-mcp`）、リポジトリ直下に `server.json`（MCP Registry 用。npm パッケージには同梱しない）、`.claude-plugin/plugin.json`（Claude Code の plugin 定義）
- `scripts/sync-plugin-version.mjs`: `npm version` のフックで `plugin.json` と `server.json` の版を `package.json` に揃える

## 0.1.0 (2026-10-26)

最初の版。段階 2 の s1000d-verify-mcp です（ROADMAP の作業 6）。

### 追加

- 5 ツール: `verify_data_module` / `validate_schema` / `check_references` / `verify_csdb` / `list_schemas`
- `initialize` の `instructions` に「しないこと」（準拠の判定、重大度の解釈、BREX ルールの説明、適用性の判定、仕様書の同梱）を先に書く
- 検証の処理は `@shuji-bonji/s1000d-core` 0.2.0（`verifyDataModule` / `findSchemaDirs` / `Libxml2SchemaValidator` / `CsdbIndex`）を呼ぶだけ。応答の `verification` は core の `VerificationStatus`
- 仕様書の章への `dmRef`（モデル識別コード `S1000D`）は `references.specificationReferences` として別枠で返す

### 注記

- `S1000D_SPEC_DIR` の下のデータ辞書（`data_dictionary_7/Files/xml_schema_flat/`）にある XSD の写しは使いません。import が絶対 URL で、libxml2 がオフラインでは解決できないためです。core 0.2.1 でも同じ除外が入ります。
