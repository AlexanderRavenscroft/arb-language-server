import { JSONDocument } from "vscode-json-languageservice";
import { Diagnostic, DiagnosticSeverity } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { L10nConfiguration } from "./l10n_manager";

export interface ArbValidationContext {
  readonly document: TextDocument;
  readonly jsonDocument: JSONDocument;
  readonly l10nConfiguration: L10nConfiguration | undefined;
}

export type ArbValidator = (
  context: ArbValidationContext,
) => Diagnostic[] | Promise<Diagnostic[]>;

// Only letters, underscores, and numbers are allowed, but the first character must be a letter
const MESSAGE_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

const arbValidators: ArbValidator[] = [
  validateMetadataHasMessage,
  validateMessageHasMetadata,
  validateKeyFormat,
  validateMissingMessages,
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
      createDiagnostic({
        document,
        offset: metadataKeyNode.offset,
        length: metadataKeyNode.length,
        message: `Metadata for an undefined key. Add a message key with the name "${referencedMessageKey}".`,
        code: "arb/metadata-for-missing-key",
      }),
    );
  }

  return diagnostics;
}

/// Check if every message in the template has metadata defined
function validateMessageHasMetadata({
  document,
  jsonDocument,
  l10nConfiguration,
}: ArbValidationContext): Diagnostic[] {
  if (
    !l10nConfiguration ||
    !document.uri.startsWith("file:") ||
    jsonDocument.root?.type !== "object"
  ) {
    return [];
  }

  const documentPath = resolve(fileURLToPath(document.uri));

  if (documentPath !== l10nConfiguration.templateArbPath) {
    return [];
  }

  const topLevelProperties = jsonDocument.root.properties;
  const definedMetadataKeys = new Set(
    topLevelProperties
      .filter((property) => property.keyNode.value.startsWith("@"))
      .map((property) => property.keyNode.value),
  );
  const diagnostics: Diagnostic[] = [];

  for (const property of topLevelProperties) {
    const messageKeyNode = property.keyNode;
    const messageKey = messageKeyNode.value;

    if (
      messageKey.startsWith("@") ||
      definedMetadataKeys.has(`@${messageKey}`)
    ) {
      continue;
    }

    diagnostics.push(
      createDiagnostic({
        document,
        offset: messageKeyNode.offset,
        length: messageKeyNode.length,
        message: `Message does not have metadata defined. Add metadata with the key "@${messageKey}".`,
        code: "arb/message-without-metadata",
        severity: DiagnosticSeverity.Information,
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
      createDiagnostic({
        document,
        offset: messageKeyNode.offset,
        length: messageKeyNode.length,
        message: `Key "${messageKey}" is not a valid message key. The key must start with a letter and contain only letters, numbers, or underscores.`,
        code: "arb/invalid-key",
      }),
    );
  }

  return diagnostics;
}

async function validateMissingMessages({
  document,
  jsonDocument,
  l10nConfiguration,
}: ArbValidationContext): Promise<Diagnostic[]> {
  if (
    !l10nConfiguration ||
    !document.uri.startsWith("file:") ||
    jsonDocument.root?.type !== "object"
  ) {
    return [];
  }

  const documentPath = resolve(fileURLToPath(document.uri));

  if (
    dirname(documentPath) !== l10nConfiguration.arbDirectory ||
    documentPath === l10nConfiguration.templateArbPath
  ) {
    return [];
  }

  let template: unknown;

  try {
    const content = await readFile(l10nConfiguration.templateArbPath, "utf8");
    template = JSON.parse(content);
  } catch {
    return [];
  }

  if (
    typeof template !== "object" ||
    template === null ||
    Array.isArray(template)
  ) {
    return [];
  }

  const existingKeys = new Set(
    jsonDocument.root.properties.map((property) => property.keyNode.value),
  );

  const missingKeys = Object.keys(template).filter(
    (key) => !key.startsWith("@") && !existingKeys.has(key),
  );

  if (missingKeys.length === 0) {
    return [];
  }

  return [
    createDiagnostic({
      document,
      offset: document.getText().length,
      severity: DiagnosticSeverity.Warning,
      code: "arb/missing-messages",
      message:
        `Missing messages defined in "${l10nConfiguration.templateArbFile}": ` +
        missingKeys.join(", "),
    }),
  ];
}

interface DiagnosticOptions {
  readonly document: TextDocument;
  readonly offset: number;
  readonly length?: number;
  readonly message: string;
  readonly code: string;
  readonly severity?: DiagnosticSeverity;
}

function createDiagnostic({
  document,
  offset,
  length = 0,
  message,
  code,
  severity = DiagnosticSeverity.Error,
}: DiagnosticOptions): Diagnostic {
  return {
    range: {
      start: document.positionAt(offset),
      end: document.positionAt(offset + length),
    },
    severity,
    code,
    source: "arb-language-server",
    message,
  };
}
