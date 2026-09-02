import { JSONDocument, StringASTNode } from "vscode-json-languageservice";
import { Diagnostic, DiagnosticSeverity } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";

export interface ArbValidationContext {
  readonly document: TextDocument;
  readonly jsonDocument: JSONDocument;
}

export type ArbValidator = (
  context: ArbValidationContext,
) => Diagnostic[] | Promise<Diagnostic[]>;

// Only letters, underscores, and numbers are allowed, but the first character must be a letter
const MESSAGE_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

const arbValidators: ArbValidator[] = [
  validateMetadataHasMessage,
  validateKeyFormat,
];

/// Delegate all validators
export async function collectArbDiagnostics(
  context: ArbValidationContext,
): Promise<Diagnostic[]> {
  const diagnosticGroups = await Promise.all(
    arbValidators.map((validator) => validator(context)),
  );

  return diagnosticGroups.flat();
}

/// Check if any metadata is defined for a message which doesn't exist
function validateMetadataHasMessage({
  document,
  jsonDocument,
}: ArbValidationContext): Diagnostic[] {
  if (jsonDocument.root?.type !== "object") {
    return [];
  }

  const topLevelProperties = jsonDocument.root.properties;
  const definedMessageKeys = new Set(
    topLevelProperties
      .filter((property) => !property.keyNode.value.startsWith("@"))
      .map((property) => property.keyNode.value),
  );

  const diagnostics: Diagnostic[] = [];

  for (const property of topLevelProperties) {
    const metadataKeyNode = property.keyNode;
    const metadataKey = metadataKeyNode.value;

    if (!metadataKey.startsWith("@") || metadataKey.startsWith("@@")) {
      continue;
    }

    const referencedMessageKey = metadataKey.slice(1);

    if (definedMessageKeys.has(referencedMessageKey)) {
      continue;
    }

    diagnostics.push(
      createKeyDiagnostic({
        document,
        keyNode: metadataKeyNode,
        message: `Metadata for an undefined key. Add a message key with the name "${referencedMessageKey}".`,
        code: "arb/metadata-for-missing-key",
      }),
    );
  }

  return diagnostics;
}

/// Validate that message keys are valid public Dart identifiers
function validateKeyFormat({
  document,
  jsonDocument,
}: ArbValidationContext): Diagnostic[] {
  if (jsonDocument.root?.type !== "object") {
    return [];
  }

  const diagnostics: Diagnostic[] = [];

  for (const property of jsonDocument.root.properties) {
    const messageKeyNode = property.keyNode;
    const messageKey = messageKeyNode.value;

    if (messageKey.startsWith("@") || MESSAGE_KEY_PATTERN.test(messageKey)) {
      continue;
    }

    diagnostics.push(
      createKeyDiagnostic({
        document,
        keyNode: messageKeyNode,
        message: `Key "${messageKey}" is not a valid message key. The key must start with a letter and contain only letters, numbers, or underscores.`,
        code: "arb/invalid-key",
      }),
    );
  }

  return diagnostics;
}

interface KeyDiagnosticOptions {
  readonly document: TextDocument;
  readonly keyNode: StringASTNode;
  readonly message: string;
  readonly code: string;
  readonly severity?: DiagnosticSeverity;
}

function createKeyDiagnostic({
  document,
  keyNode,
  message,
  code,
  severity = DiagnosticSeverity.Error,
}: KeyDiagnosticOptions): Diagnostic {
  return {
    range: {
      start: document.positionAt(keyNode.offset),
      end: document.positionAt(keyNode.offset + keyNode.length),
    },
    severity,
    code,
    source: "arb-language-server",
    message,
  };
}
