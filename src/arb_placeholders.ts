import { JSONDocument, StringASTNode } from "vscode-json-languageservice";

// Dollar signs are also allowed after the first character for Dart placeholder identifiers
export const PLACEHOLDER_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_$]*$/;

const COMPLEX_MESSAGE_TYPES = new Set(["plural", "select", "gender"]);

export interface PlaceholderOccurrence {
  readonly value: string;
  readonly start: number;
  readonly end: number;
}

export interface MessagePlaceholderOptions {
  readonly useEscaping?: boolean;
  readonly relaxSyntax?: boolean;
  readonly validPlaceholderNames?: ReadonlySet<string>;
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
  {
    useEscaping = false,
    relaxSyntax = false,
    validPlaceholderNames,
  }: MessagePlaceholderOptions = {},
): PlaceholderOccurrence[] {
  const placeholders: PlaceholderOccurrence[] = [];
  const syntaxMessage = useEscaping ? maskEscapedSyntax(message) : message;

  parseMessage(0, false);

  return placeholders;

  function parseMessage(start: number, stopAtClosingBrace: boolean): number {
    let index = start;

    while (index < syntaxMessage.length) {
      if (syntaxMessage[index] === "}" && stopAtClosingBrace) {
        return index;
      }

      if (syntaxMessage[index] !== "{") {
        index += 1;
        continue;
      }

      if (relaxSyntax && !isValidRelaxedPlaceholder(index)) {
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
      delimiter < syntaxMessage.length &&
      syntaxMessage[delimiter] !== "," &&
      syntaxMessage[delimiter] !== "}"
    ) {
      delimiter += 1;
    }

    if (delimiter >= syntaxMessage.length) {
      return syntaxMessage.length;
    }

    const rawName = message.slice(nameStart, delimiter);
    const placeholderName = rawName.trim();
    const leadingWhitespaceLength = rawName.length - rawName.trimStart().length;
    const placeholderStart = nameStart + leadingWhitespaceLength;

    placeholders.push({
      value: placeholderName,
      start: placeholderStart,
      end: placeholderStart + placeholderName.length,
    });

    if (syntaxMessage[delimiter] === "}") {
      return delimiter + 1;
    }

    const typeStart = delimiter + 1;
    let typeEnd = typeStart;

    while (
      typeEnd < syntaxMessage.length &&
      syntaxMessage[typeEnd] !== "," &&
      syntaxMessage[typeEnd] !== "}"
    ) {
      typeEnd += 1;
    }

    if (typeEnd >= syntaxMessage.length || syntaxMessage[typeEnd] === "}") {
      return Math.min(typeEnd + 1, syntaxMessage.length);
    }

    const argumentType = message.slice(typeStart, typeEnd).trim();

    if (COMPLEX_MESSAGE_TYPES.has(argumentType)) {
      return parseComplexArgument(typeEnd + 1);
    }

    return skipArgument(openingBrace);
  }

  function parseComplexArgument(start: number): number {
    let index = start;

    while (index < syntaxMessage.length) {
      if (syntaxMessage[index] === "}") {
        return index + 1;
      }

      if (syntaxMessage[index] !== "{") {
        index += 1;
        continue;
      }

      const submessageEnd = parseMessage(index + 1, true);
      index =
        submessageEnd < syntaxMessage.length
          ? submessageEnd + 1
          : submessageEnd;
    }

    return index;
  }

  function skipArgument(openingBrace: number): number {
    let depth = 1;
    let index = openingBrace + 1;

    while (index < syntaxMessage.length && depth > 0) {
      if (syntaxMessage[index] === "{") {
        depth += 1;
      } else if (syntaxMessage[index] === "}") {
        depth -= 1;
      }

      index += 1;
    }

    return index;
  }

  function isValidRelaxedPlaceholder(openingBrace: number): boolean {
    const nameStart = openingBrace + 1;
    let delimiter = nameStart;

    while (
      delimiter < syntaxMessage.length &&
      syntaxMessage[delimiter] !== "," &&
      syntaxMessage[delimiter] !== "}"
    ) {
      delimiter += 1;
    }

    if (delimiter >= syntaxMessage.length) {
      return false;
    }

    const placeholderName = syntaxMessage.slice(nameStart, delimiter).trim();

    return (
      PLACEHOLDER_NAME_PATTERN.test(placeholderName) &&
      (validPlaceholderNames === undefined ||
        validPlaceholderNames.has(placeholderName))
    );
  }
}

function maskEscapedSyntax(message: string): string {
  const characters = message.split("");
  let index = 0;

  while (index < characters.length) {
    if (characters[index] !== "'") {
      index += 1;
      continue;
    }

    if (characters[index + 1] === "'") {
      index += 2;
      continue;
    }

    index += 1;

    while (index < characters.length) {
      if (characters[index] === "'") {
        if (characters[index + 1] === "'") {
          index += 2;
          continue;
        }

        index += 1;
        break;
      }

      if (characters[index] === "{" || characters[index] === "}") {
        characters[index] = " ";
      }

      index += 1;
    }
  }

  return characters.join("");
}
