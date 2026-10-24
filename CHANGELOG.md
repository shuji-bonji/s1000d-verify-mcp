# Changelog

## 未リリース（0.1.0 に向けて）

最初の版。段階 2 の s1000d-verify-mcp です（ROADMAP の作業 6）。

### 追加

- 5 ツール: `verify_data_module` / `validate_schema` / `check_references` / `verify_csdb` / `list_schemas`
- `initialize` の `instructions` に「しないこと」（準拠の判定、重大度の解釈、BREX ルールの説明、適用性の判定、仕様書の同梱）を先に書く
- 検証の処理は `@shuji-bonji/s1000d-core` 0.2.0（`verifyDataModule` / `findSchemaDirs` / `Libxml2SchemaValidator` / `CsdbIndex`）を呼ぶだけ。応答の `verification` は core の `VerificationStatus`
- 仕様書の章への `dmRef`（モデル識別コード `S1000D`）は `references.specificationReferences` として別枠で返す

### 注記

- `S1000D_SPEC_DIR` の下のデータ辞書（`data_dictionary_7/Files/xml_schema_flat/`）にある XSD の写しは使いません。import が絶対 URL で、libxml2 がオフラインでは解決できないためです。core 0.2.1 でも同じ除外が入ります。
