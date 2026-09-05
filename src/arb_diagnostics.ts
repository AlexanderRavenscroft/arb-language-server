import { JSONDocument, StringASTNode } from "vscode-json-languageservice";
import { Diagnostic, DiagnosticSeverity } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { L10nConfiguration } from "./l10n_manager";
import {
  findMessagePlaceholders,
  getMetadataPlaceholderNodesByMessage,
  PLACEHOLDER_NAME_PATTERN,
} from "./arb_placeholders";

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

/// Check message metadata and placeholder consistency in the template
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
  const metadataPlaceholdersByMessage =
    getMetadataPlaceholderNodesByMessage(jsonDocument);
  const diagnostics: Diagnostic[] = [];

  for (const property of topLevelProperties) {
    const messageKeyNode = property.keyNode;
    const messageKey = messageKeyNode.value;

    if (messageKey.startsWith("@")) {
      continue;
    }

    if (!definedMetadataKeys.has(`@${messageKey}`)) {
      diagnostics.push(
        createDiagnostic({
          document,
          offset: messageKeyNode.offset,
          length: messageKeyNode.length,
          message: l10nConfiguration.requiredResourceAttributes
            ? `Message metadata is required by "required-resource-attributes". Add metadata with the key "@${messageKey}".`
            : `Message does not have metadata defined. Add metadata with the key "@${messageKey}".`,
          code: "arb/message-without-metadata",
          severity: l10nConfiguration.requiredResourceAttributes
            ? DiagnosticSeverity.Error
            : DiagnosticSeverity.Information,
        }),
      );
    }

    if (property.valueNode?.type !== "string") {
      continue;
    }

    const messageNode = property.valueNode;
    const metadataPlaceholderNodes =
      metadataPlaceholdersByMessage.get(messageKey) ?? [];
    const metadataPlaceholderNames = new Set(
      metadataPlaceholderNodes.map((placeholder) => placeholder.value),
    );
    const placeholders = findMessagePlaceholders(messageNode.value, {
      useEscaping: l10nConfiguration.useEscaping,
      relaxSyntax: l10nConfiguration.relaxSyntax,
      validPlaceholderNames: metadataPlaceholderNames,
    });
    const usedPlaceholderNames = new Set(
      placeholders.map((placeholder) => placeholder.value),
    );

    for (const placeholder of placeholders) {
      const start = getStringContentDocumentOffset(
        document,
        messageNode,
        placeholder.start,
      );
      const end = getStringContentDocumentOffset(
        document,
        messageNode,
        placeholder.end,
      );

      if (!PLACEHOLDER_NAME_PATTERN.test(placeholder.value)) {
        diagnostics.push(
          createDiagnostic({
            document,
            offset: start,
            length: end - start,
            message: `"${placeholder.value}" is not a valid placeholder name. A placeholder must start with a letter and contain only letters, numbers, underscores, or dollar signs after the first character.`,
            code: "arb/invalid-placeholder",
          }),
        );
        continue;
      }

      if (!metadataPlaceholderNames.has(placeholder.value)) {
        diagnostics.push(
          createDiagnostic({
            document,
            offset: start,
            length: end - start,
            message: `Placeholder "${placeholder.value}" not defined in the message metadata.`,
            code: "arb/placeholder-without-metadata",
            severity: DiagnosticSeverity.Warning,
          }),
        );
      }
    }

    for (const placeholderNode of metadataPlaceholderNodes) {
      if (usedPlaceholderNames.has(placeholderNode.value)) {
        continue;
      }

      diagnostics.push(
        createDiagnostic({
          document,
          offset: placeholderNode.offset,
          length: placeholderNode.length,
          message: `Placeholder "${placeholderNode.value}" is defined in the message metadata, but not used in the message.`,
          code: "arb/missing-placeholder-with-metadata",
          severity: DiagnosticSeverity.Warning,
        }),
      );
    }
  }

  return diagnostics;
}

function getStringContentDocumentOffset(
  document: TextDocument,
  stringNode: StringASTNode,
  decodedOffset: number,
): number {
  const contentStart = stringNode.offset + 1;
  const contentEnd = Math.max(
    contentStart,
    stringNode.offset + stringNode.length - 1,
  );
  const rawContent = document.getText().slice(contentStart, contentEnd);
  let currentDecodedOffset = 0;
  let currentRawOffset = 0;

  while (
    currentDecodedOffset < decodedOffset &&
    currentRawOffset < rawContent.length
  ) {
    if (rawContent[currentRawOffset] !== "\\") {
      currentRawOffset += 1;
      currentDecodedOffset += 1;
      continue;
    }

    if (rawContent[currentRawOffset + 1] === "u") {
      currentRawOffset += Math.min(6, rawContent.length - currentRawOffset);
    } else {
      currentRawOffset += Math.min(2, rawContent.length - currentRawOffset);
    }

    currentDecodedOffset += 1;
  }

  return contentStart + currentRawOffset;
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

/// Check if there is any message without metadata in the template
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
