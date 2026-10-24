/**
 * s1000d-verify-mcp の組み立て。index.ts は起動だけを担い、テストからはこの関数を直接叩く。
 */
import { McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { ENV, PACKAGE_INFO } from './config.js';
import { tools } from './tools/definitions.js';
import { toolHandlers } from './tools/handlers.js';

/**
 * `initialize` の応答としてクライアントへ返す説明。README やツール説明より早く読まれる。
 *
 * 潰したい誤解:
 * 1. XSD と BREX に通れば S1000D 準拠だと読まれること。nonContextRules と人が読むビジネスルール文書が残る。
 * 2. XSD が見つからないときに「検証した」と読まれること。schema.state は schema-not-found になる。
 * 3. BREX ルールの意味や値の意味までここで分かると読まれること。それは s1000d-brex-mcp の explain_brex / lookup_value。
 * 4. 仕様書の章への dmRef（モデル識別コード S1000D）を「参照切れ」と読まれること。別枠で返す。
 */
const INSTRUCTIONS = `This server VERIFIES S1000D data modules: XML schema (XSD) validation with the user's own S1000D schemas, BREX (Business Rules Exchange) checks along the brexDmRef chain, and reference resolution. Every result carries a "verification" status (VerificationStatus) with one state per step: schema (valid / invalid / schema-not-found / not-run), brex (passed / violations / incomplete / not-run), references (resolved / unresolved / not-run).

It does NOT do the following:
- It does not decide S1000D conformance. schema "valid" plus brex "passed" means only that the XSD and the machine-checkable BREX rules found nothing; nonContextRules are returned as manualChecks for a person, and the project's human-readable business rules are outside any tool.
- It does not interpret severity codes (brsl01..brsl99) or explain BREX rules and value meanings; use s1000d-brex-mcp (explain_brex, lookup_value) for that.
- It does not evaluate applicability (which product a passage applies to); check_references only verifies that applicRefId targets exist. Use s1000d-reader-mcp for applicability.
- It does not ship any S1000D specification, XSD or default BREX. The user must download the distribution from s1000d.org and set ${ENV.specDir} to the extracted folder (the XSDs are found in its xml_schema_flat/ folder; the issue is read from brex.xsd). Project data modules are found via ${ENV.csdbDirs} or the "csdbDirs" argument.

Reading results: "schema-not-found" is not "valid" — the schema step did not run; call list_schemas to see what was found. brex "incomplete" means a BREX in the chain was missing or a rule could not be evaluated; treat it as not checked. references.specificationReferences lists dmRef to the S1000D specification itself (modelIdentCode "S1000D"); they are never in a CSDB and are not errors. An XSD-invalid document can produce misleading BREX findings.

Costly options: verify_csdb runs all steps on every object; use "skip" and "limit" for large CSDBs, and "reportPath" to keep the details out of the response.`;

export function buildServer(): McpServer {
  const server = new McpServer(
    { name: PACKAGE_INFO.name, version: PACKAGE_INFO.version },
    { instructions: INSTRUCTIONS },
  );
  for (const tool of tools) {
    const handler = toolHandlers[tool.name];
    if (!handler) throw new Error(`No handler registered for tool: ${tool.name}`);
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: fromJsonSchema<Record<string, unknown>>(tool.inputSchema),
      },
      async (args) => {
        try {
          const result = await handler(args as Record<string, unknown>);
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: message }, null, 2) }],
            isError: true,
          };
        }
      },
    );
  }
  return server;
}
