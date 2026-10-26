# @shuji-bonji/s1000d-verify-mcp

[English](./README.md) | **日本語**

S1000D® のデータモジュールを LLM が「どこまで確認済みか」を根拠付きで知るための MCP サーバーです。XML スキーマ（XSD）による検証、BREX（Business Rules Exchange）への照合、参照（`dmRef`・`pmRef`・ICN・`internalRef`・`applicRefId`）の解決の 3 つを行い、結果を 1 つの検証状態（`verification`）にまとめて返します。この検証状態は `s1000d-reader-mcp` が本文の応答に埋め込むものと同じ形です。

> [!IMPORTANT]
> このサーバーは ASD（Aerospace, Security and Defence Industries Association of Europe）とは無関係の個人プロジェクトです。S1000D® は ASD の登録商標です。
> S1000D の仕様書・XML スキーマ・既定 BREX・公式サンプルは、利用条件により再配布できないため、このパッケージには含まれていません。XSD 検証と既定 BREX への照合を行うには、利用者ご自身で [s1000d.org](https://s1000d.org/) から配布物を入手し、展開したフォルダーを環境変数 `S1000D_SPEC_DIR` で指定してください。

## できること

| ツール | 内容 |
|---|---|
| `verify_data_module` | データモジュール 1 件を、整形式 → XSD → BREX の連鎖 → 参照の順に検証し、`verification`（検証状態）と各工程の詳細（XSD 違反の行番号、BREX 違反の箇所、未解決の参照と理由）を返します |
| `validate_schema` | XSD 検証だけを行います。使う XSD は `xsi:noNamespaceSchemaLocation` のファイル名で決め、`S1000D_SPEC_DIR` の下の `xml_schema_flat/` から探します。版は `brex.xsd` 冒頭の `Issue number:` から読みます |
| `check_references` | 参照を 5 種類（`dmRef` / `pmRef` / ICN / `internalRef` / `applicRefId`）集め、参照先の有無を理由付きで返します。仕様書の章への `dmRef`（モデル識別コード `S1000D`）は参照切れではないので別枠にします |
| `verify_csdb` | フォルダーの中の CSDB オブジェクト（既定は DMC と PMC）をまとめて検証し、1 件ごとの検証状態と件数の集計を返します。`offset` / `limit` で分けて読み、`reportPath` で詳細を JSON に書き出せます |
| `suggest_fixes` | `verify_data_module` と同じ検証を行い、違反ごとに直し方の候補を返します。候補はサーバーが決め、出どころ（BREX のルール ID、XSD の定義、CSDB、文書内の id、ACT・CCT・PCT）と確からしさ（`exact` / `several` / `none`）を付けます。`product` を渡すと、製品の値が足りず判定できない適用性にも、与える値の候補を付けます。修正の適用はしません |
| `list_schemas` | `S1000D_SPEC_DIR` の下で見つかった `xml_schema_flat/` の一覧（版、XSD の数、スキーマ名）を返します。`schema-not-found` の原因を調べるのに使います |

### 検証状態（`verification`）

| 項目 | 値 | 意味 |
|---|---|---|
| `schema.state` | `valid` / `invalid` / `schema-not-found` / `not-run` | XSD を見つけて検証し違反 0 / 違反あり / XSD が見つからない（`reason` に理由）/ `skip` で省いた |
| `brex.state` | `passed` / `violations` / `incomplete` / `not-run` | すべての層で違反 0 / 違反あり / 未解決の BREX か評価できないルールがある / 省いた |
| `references.state` | `resolved` / `unresolved` / `not-run` | 未解決 0 / 未解決あり / 省いた |

`schema-not-found` は `valid` ではありません。XSD 検証が行われなかったことを表します。

## できないこと

> [!WARNING]
> - **S1000D への準拠を判定しません。** `schema: valid` と `brex: passed` は「XSD と、機械で検査できる BREX のルールに誤りが無かった」ことだけを意味します。`nonContextRules`（文章で書かれた取り決め）は `manualChecks` として返し、判断は人が行います。プロジェクトのビジネスルール文書はどのツールの対象でもありません。
> - BREX のルールの説明や値の意味は返しません。それは `s1000d-brex-mcp` の `explain_brex` / `lookup_value` の仕事です。重大度コード（`brsl01`〜`brsl99`）はそのまま返します。
> - 適用性（どの製品に当てはまるか）は判定しません。`check_references` は `applicRefId` の参照先があるかだけを見ます。判定は `s1000d-reader-mcp` が行います。例外は `product` を渡した `suggest_fixes` で、製品の値が足りず判定できない適用性だけを報告します。
> - 修正を文書に当てません。`suggest_fixes` は候補を返すだけです。LLM には候補の中から選ばせ、`confidence` が `none` のときは利用者に聞かせてください（`instructions` にも書いてあります）。

> [!NOTE]
> XSD に違反した文書では、要素の位置が仕様と違う可能性があるため、BREX の違反が誤って出たり隠れたりします。`schema.state` が `invalid` のときは BREX の結果を参考程度に読んでください（応答の `_notes` にも書きます）。

## 設定

| 環境変数 | 内容 |
|---|---|
| `S1000D_SPEC_DIR` | 利用者が入手した S1000D の配布物を展開したフォルダー。XSD（`xml_schema_flat/`。内側の「XML Schema Package」の zip を展開しておく）と既定 BREX（`DMC-S1000D-*-04-10-0301-00A-022A-D_*.XML`）をこの下から探します。データ辞書の中にある XSD の写しは使いません（import が絶対 URL で、オフラインでは解決できないため） |
| `S1000D_CSDB_DIR` | プロジェクトのデータモジュールが置かれたフォルダー。`:`（Windows は `;`）区切りで複数指定できます。参照先の DM・PM・ICN ファイルと、連鎖の途中の BREX をここから探します |

ツールの引数 `csdbDirs` でフォルダーを追加することもできます。

### Claude Desktop / Claude Code の設定例

```json
{
  "mcpServers": {
    "s1000d-verify": {
      "command": "npx",
      "args": ["-y", "@shuji-bonji/s1000d-verify-mcp"],
      "env": {
        "S1000D_SPEC_DIR": "/path/to/s1000d/issue-7",
        "S1000D_CSDB_DIR": "/path/to/your/csdb"
      }
    }
  }
}
```

## 仕組み

検証の処理はすべて共有ライブラリ [`@shuji-bonji/s1000d-core`](https://www.npmjs.com/package/@shuji-bonji/s1000d-core) にあり、このサーバーは引数の解釈と応答の形だけを持ちます。XSD 検証は `libxml2-wasm`（libxml2 の WebAssembly 版）で、XSD ごとに 1 回コンパイルして使い回すため、Issue 7 の公式サンプル 106 件を 0.5 秒以内で検証できます。BREX の照合は `s1000d-brex-mcp` と同じ関数を呼ぶので、2 つのサーバーの結果は一致します。

## 開発

```sh
npm install
npm test            # 自作のテストデータだけで動く
npm run test:spec   # 利用者が入手した配布物を使う（S1000D_SPEC_DIR で場所を指定。既定 ../../specs/s1000d/issue-7）
npm run build && S1000D_SPEC_DIR=/path/to/issue-7 npm start   # stdio で起動
```

## ライセンス

MIT。S1000D® は ASD の登録商標です。このソフトウェアは ASD とは無関係で、仕様書・スキーマ・公式サンプルを含みません。
