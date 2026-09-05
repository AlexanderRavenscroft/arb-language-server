import { JSONDocument, StringASTNode } from "vscode-json-languageservice";

// Dollar signs are also allowed after the first character for Dart placeholder identifiers
export const PLACEHOLDER_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_$]*$/;

const COMPLEX_MESSAGE_TYPES = new Set(["plural", "select", "gender"]);

export interface PlaceholderOccurrence {
  readonly value: string;
  readonly start: number;
  readonly end: number;
}

export function getMetadataPlaceholderNodesByMessage(
  jsonDocument: JSONDocument,
): ReadonlyMap<string, StringASTNode[]> {
  const placeholdersByMessage = new Map<string, StringASTNode[]>();

  if (jsonDocument.root?.type !== "object") {
    return placeholdersByMessage;
  }

  for (const property of jsonDocument.root.properties) {
    const metadataKey = property.keyNode.value;
    const metadataNode = property.valueNode;

    if (
      !metadataKey.startsWith("@") ||
      metadataKey.startsWith("@@") ||
      metadataNode?.type !== "object" ||
      placeholdersByMessage.has(metadataKey.slice(1))
    ) {
      continue;
    }

    const placeholdersNode = metadataNode.properties.find(
      (metadataProperty) =>
        metadataProperty.keyNode.value === "placeholders" &&
        metadataProperty.valueNode?.type === "object",
    )?.valueNode;

    placeholdersByMessage.set(
      metadataKey.slice(1),
      placeholdersNode?.type === "object"
        ? placeholdersNode.properties.map(
            (placeholderProperty) => placeholderProperty.keyNode,
          )
        : [],
    );
  }

  return placeholdersByMessage;
}

export function findMessagePlaceholders(
  message: string,
): PlaceholderOccurrence[] {
  const placeholders: PlaceholderOccurrence[] = [];

  parseMessage(0, false);

  return placeholders;

  function parseMessage(start: number, stopAtClosingBrace: boolean): number {
    let index = start;

    while (index < message.length) {
      if (message[index] === "}" && stopAtClosingBrace) {
        return index;
      }

      if (message[index] !== "{") {
        index += 1;
        continue;
      }

      const argumentEnd = parseArgument(index);
      index = argumentEnd > index ? argumentEnd : index + 1;
    }

    return index;
  }

  function parseArgument(openingBrace: number): number {
    const nameStart = openingBrace + 1;
    let delimiter = nameStart;

    while (
      delimiter < message.length &&
      message[delimiter] !== "," &&
      message[delimiter] !== "}"
    ) {
      delimiter += 1;
    }

    if (delimiter >= message.length) {
      return message.length;
    }

    placeholders.push({
      value: message.slice(nameStart, delimiter),
      start: nameStart,
      end: delimiter,
    });

    if (message[delimiter] === "}") {
      return delimiter + 1;
    }

    const typeStart = delimiter + 1;
    let typeEnd = typeStart;

    while (
      typeEnd < message.length &&
      message[typeEnd] !== "," &&
      message[typeEnd] !== "}"
    ) {
      typeEnd += 1;
    }

    if (typeEnd >= message.length || message[typeEnd] === "}") {
      return Math.min(typeEnd + 1, message.length);
    }

    const argumentType = message.slice(typeStart, typeEnd).trim();

    if (COMPLEX_MESSAGE_TYPES.has(argumentType)) {
      return parseComplexArgument(typeEnd + 1);
    }

    return skipArgument(openingBrace);
  }

  function parseComplexArgument(start: number): number {
    let index = start;

    while (index < message.length) {
      if (message[index] === "}") {
        return index + 1;
      }

      if (message[index] !== "{") {
        index += 1;
        continue;
      }

      const submessageEnd = parseMessage(index + 1, true);
      index =
        submessageEnd < message.length ? submessageEnd + 1 : submessageEnd;
    }

    return index;
  }

  function skipArgument(openingBrace: number): number {
    let depth = 1;
    let index = openingBrace + 1;

    while (index < message.length && depth > 0) {
      if (message[index] === "{") {
        depth += 1;
      } else if (message[index] === "}") {
        depth -= 1;
      }

      index += 1;
    }

    return index;
  }
}
