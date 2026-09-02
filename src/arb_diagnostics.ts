import { JSONDocument } from "vscode-json-languageservice";
import { Diagnostic, DiagnosticSeverity } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";

export interface ArbValidationContext {
  readonly document: TextDocument;
  readonly jsonDocument: JSONDocument;
}

export type ArbValidator = (
  context: ArbValidationContext,
) => Diagnostic[] | Promise<Diagnostic[]>;

export const arbValidators: ArbValidator[] = [validateExampleDiagnostic];

export async function collectArbDiagnostics(
  context: ArbValidationContext,
): Promise<Diagnostic[]> {
  const diagnosticGroups = await Promise.all(
    arbValidators.map((validator) => validator(context)),
  );

  return diagnosticGroups.flat();
}

function validateExampleDiagnostic({
  document,
  jsonDocument,
}: ArbValidationContext): Diagnostic[] {
  if (jsonDocument.root?.type !== "object") {
    return [];
  }

  const exampleProperty = jsonDocument.root.properties.find(
    (property) => property.keyNode.value === "__arb_lsp_error__",
  );

  if (!exampleProperty) {
    return [];
  }

  const key = exampleProperty.keyNode;
  return [
    {
      range: {
        start: document.positionAt(key.offset),
        end: document.positionAt(key.offset + key.length),
      },
      severity: DiagnosticSeverity.Error,
      code: "arb/example",
      source: "arb-language-server",
      message:
        "This is custom LSP diagnostic, not from the JSON language service.",
    },
  ];
}
