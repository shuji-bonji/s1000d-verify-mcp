# Changelog

## 未リリース（0.2.0 に向けて）

段階 2.5 の作業 2（D-19、design/agent-platform.md「修正提案の設計」）。**`@shuji-bonji/s1000d-core` 0.3.0（`suggestFixes`）の公開を待ってから依存を上げて公開します。**

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
