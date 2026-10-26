# @shuji-bonji/s1000d-verify-mcp

**English** | [日本語](./README.ja.md)

An MCP server that lets an LLM know, with evidence, how far an S1000D® data module has been checked. It performs three steps — validation against the XML schema (XSD), a check against BREX (Business Rules Exchange), and resolution of references (`dmRef`, `pmRef`, ICN, `internalRef` and `applicRefId`) — and returns the results combined into a single verification status (`verification`). This verification status has the same shape as the one `s1000d-reader-mcp` embeds in its content responses.

> [!IMPORTANT]
> This is a personal project and is not affiliated with ASD (Aerospace, Security and Defence Industries Association of Europe). S1000D® is a registered trademark of ASD.
> The S1000D specification, XML schemas, default BREX and official samples are not included in any package or repository, because their terms of use do not grant redistribution. To run XSD validation and checks against the default BREX, obtain them from [s1000d.org](https://s1000d.org/) yourself and point the `S1000D_SPEC_DIR` environment variable at the extracted folder.

## What it does

| Tool | Description |
|---|---|
| `verify_data_module` | Validates one data module in the order well-formedness → XSD → BREX chain → references, and returns `verification` (the verification status) together with the details of each step (line numbers of XSD violations, locations of BREX violations, unresolved references and their reasons) |
| `validate_schema` | Runs XSD validation only. The XSD to use is chosen from the file name in `xsi:noNamespaceSchemaLocation` and looked up under `xml_schema_flat/` below `S1000D_SPEC_DIR`. The issue is read from the `Issue number:` line at the top of `brex.xsd` |
| `check_references` | Collects references of 5 kinds (`dmRef` / `pmRef` / ICN / `internalRef` / `applicRefId`) and returns whether each target exists, with a reason. A `dmRef` to a chapter of the specification (model identification code `S1000D`) is not a broken reference, so it is reported separately |
| `verify_csdb` | Validates the CSDB objects in a folder (DMC and PMC by default) in one run, and returns the verification status of each object and a count summary. Read the results in parts with `offset` / `limit`, and write the details to JSON with `reportPath` |
| `suggest_fixes` | Runs the same verification as `verify_data_module` and returns fix candidates for each finding. The server decides the candidates and adds their origin (BREX rule ID, XSD definition, CSDB, ids in the document, ACT/CCT/PCT) and their certainty (`exact` / `several` / `none`). If `product` is given, applicability that cannot be decided because the product lacks a value also gets candidate values. It does not apply fixes |
| `list_schemas` | Returns the list of `xml_schema_flat/` folders found under `S1000D_SPEC_DIR` (issue, number of XSDs, schema names). Use it to investigate the cause of `schema-not-found` |

### Verification status (`verification`)

| Field | Value | Meaning |
|---|---|---|
| `schema.state` | `valid` / `invalid` / `schema-not-found` / `not-run` | XSD found and validated with 0 violations / violations found / XSD not found (reason in `reason`) / skipped with `skip` |
| `brex.state` | `passed` / `violations` / `incomplete` / `not-run` | 0 violations in every layer / violations found / an unresolved BREX or a rule that cannot be evaluated / skipped |
| `references.state` | `resolved` / `unresolved` / `not-run` | 0 unresolved / unresolved references found / skipped |

`schema-not-found` is not `valid`. It means that XSD validation did not run.

## What it does not do

> [!WARNING]
> - **It does not decide conformance to S1000D.** `schema: valid` and `brex: passed` mean only that no errors were found against the XSD and the BREX rules that a machine can check. `nonContextRules` (agreements written as prose) are returned as `manualChecks`, and a person makes the judgement. A project's business rules document is outside the scope of every tool.
> - It does not return explanations of BREX rules or the meaning of values. That is the job of `explain_brex` / `lookup_value` in `s1000d-brex-mcp`. Severity level codes (`brsl01` to `brsl99`) are returned as they are.
> - It does not evaluate applicability (which product the content applies to). `check_references` only looks at whether the target of `applicRefId` exists. The evaluation is done by `s1000d-reader-mcp`. The exception is `suggest_fixes` with `product`, which reports only applicability that cannot be decided because the product lacks a value.
> - It does not apply fixes to the document. `suggest_fixes` only returns candidates. Have the LLM choose among the candidates, and ask the user when `confidence` is `none` (the `instructions` say the same).

> [!NOTE]
> In a document that violates the XSD, elements may be in positions that differ from the specification, so BREX violations can be reported falsely or hidden. When `schema.state` is `invalid`, read the BREX results as a rough indication only (the response also says so in `_notes`).

## Configuration

| Environment variable | Description |
|---|---|
| `S1000D_SPEC_DIR` | The folder where you extracted the S1000D distribution you obtained. The XSDs (`xml_schema_flat/`; extract the inner "XML Schema Package" zip beforehand) and the default BREX (`DMC-S1000D-*-04-10-0301-00A-022A-D_*.XML`) are looked up below this folder. The copies of the XSDs inside the data dictionary are not used (their imports are absolute URLs and cannot be resolved offline) |
| `S1000D_CSDB_DIR` | The folder that holds the project's data modules. Several folders can be given, separated by `:` (`;` on Windows). The referenced DM, PM and ICN files and the BREX in the middle of the chain are looked up here |

Folders can also be added with the tool argument `csdbDirs`.

### Configuration example for Claude Desktop / Claude Code

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

## How it works

All validation logic lives in the shared library [`@shuji-bonji/s1000d-core`](https://www.npmjs.com/package/@shuji-bonji/s1000d-core); this server holds only the interpretation of arguments and the shape of the responses. XSD validation uses `libxml2-wasm` (the WebAssembly build of libxml2), and each XSD is compiled once and reused, so the 106 official samples of Issue 7 are validated in under 0.5 seconds. The BREX check calls the same functions as `s1000d-brex-mcp`, so the results of the two servers match.

## Development

```sh
npm install
npm test            # runs with self-made test data only
npm run test:spec   # uses the distribution you obtained (set the location with S1000D_SPEC_DIR; default ../../specs/s1000d/issue-7)
npm run build && S1000D_SPEC_DIR=/path/to/issue-7 npm start   # starts over stdio
```

## License

MIT. S1000D® is a registered trademark of ASD. This software is not affiliated with ASD and does not include the specification, schemas or official samples.
