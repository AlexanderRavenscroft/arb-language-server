import { JSONDocument } from "vscode-json-languageservice";
import {
  CodeAction,
  CodeActionContext,
  CodeActionKind,
  Diagnostic,
  TextEdit,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { PLACEHOLDER_NAME_PATTERN } from "./arb_placeholders";

export function provideArbCodeActions(
  document: TextDocument,
  jsonDocument: JSONDocument,
  context: CodeActionContext,
): CodeAction[] {
  if (
    jsonDocument.root?.type !== "object" ||
    (context.only &&
      !context.only.some(
        (kind) => kind === "" || kind === CodeActionKind.QuickFix,
      ))
  ) {
    return [];
  }

  // Disable actions for malformed JSON
  try {
    JSON.parse(document.getText());
  } catch {
    return [];
  }

  const actions: CodeAction[] = [];

  for (const diagnostic of context.diagnostics) {
    if (diagnostic.code === "arb/placeholder-without-metadata") {
      const action = createPlaceholderMetadata(
        document,
        jsonDocument,
        diagnostic,
      );
      if (action) actions.push(action);
      continue;
    }
    if (diagnostic.code !== "arb/message-without-metadata") {
      continue;
    }

    const action = createMessageMetadata(document, jsonDocument, diagnostic);
    if (action) actions.push(action);
  }

  return actions;
}

function createMessageMetadata(
  document: TextDocument,
  jsonDocument: JSONDocument,
  diagnostic: Diagnostic,
): CodeAction | undefined {
  if (jsonDocument.root?.type !== "object") return;
  const properties = jsonDocument.root.properties;
  const text = document.getText();
  const newline = text.includes("\r\n") ? "\r\n" : "\n";

  const offset = document.offsetAt(diagnostic.range.start);
  const property = properties.find(
    (candidate) => candidate.keyNode.offset === offset,
  );
  if (
    property?.valueNode?.type !== "string" ||
    property.keyNode.value.startsWith("@")
  ) {
    return;
  }

  const key = property.keyNode.value;
  if (properties.some((candidate) => candidate.keyNode.value === `@${key}`)) {
    return;
  }

  const lineStart = text.lastIndexOf("\n", property.offset - 1) + 1;
  const indent =
    text.slice(lineStart, property.offset).match(/^[\t ]*/)?.[0] ?? "";
  const position = document.positionAt(
    property.valueNode.offset + property.valueNode.length,
  );
  return {
    title: `Add metadata for key '${key}'`,
    kind: CodeActionKind.QuickFix,
    diagnostics: [diagnostic],
    edit: {
      changes: {
        [document.uri]: [
          TextEdit.insert(
            position,
            `,${newline}${indent}${JSON.stringify(`@${key}`)}: {}`,
          ),
        ],
      },
    },
  };
}

function createPlaceholderMetadata(
  document: TextDocument,
  jsonDocument: JSONDocument,
  diagnostic: Diagnostic,
): CodeAction | undefined {
  if (jsonDocument.root?.type !== "object") return;
  const properties = jsonDocument.root.properties;
  const offset = document.offsetAt(diagnostic.range.start);
  const message = properties.find(
    ({ keyNode, valueNode }) =>
      !keyNode.value.startsWith("@") &&
      valueNode?.type === "string" &&
      offset > valueNode.offset &&
      document.offsetAt(diagnostic.range.end) <
        valueNode.offset + valueNode.length,
  );
  if (!message) return;

  const metadata = properties.find(
    (property) => property.keyNode.value === `@${message.keyNode.value}`,
  )?.valueNode;
  if (metadata?.type !== "object") return;
  const placeholders = metadata.properties.find(
    (property) => property.keyNode.value === "placeholders",
  );
  if (placeholders && placeholders.valueNode?.type !== "object") return;
  const target = placeholders?.valueNode ?? metadata;
  if (target.type !== "object") return;

  let name: string;
  try {
    name = JSON.parse(`"${document.getText(diagnostic.range)}"`);
  } catch {
    return;
  }
  if (
    !PLACEHOLDER_NAME_PATTERN.test(name) ||
    (placeholders &&
      target.properties.some((property) => property.keyNode.value === name))
  )
    return;

  const text = document.getText();
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const indentation = (position: number) =>
    text
      .slice(text.lastIndexOf("\n", position - 1) + 1, position)
      .match(/^[\t ]*/)?.[0] ?? "";
  const unit =
    (text.match(/^[\t ]+(?=")/gm) ?? []).sort(
      (a, b) => a.length - b.length,
    )[0] ?? "\t";
  const parentIndent = indentation(target.offset);
  const childIndent =
    target.properties.length &&
    document.positionAt(target.properties[0].offset).line >
      document.positionAt(target.offset).line
      ? indentation(target.properties[0].offset)
      : parentIndent + unit;
  const entry = placeholders
    ? `${JSON.stringify(name)}: {}`
    : `"placeholders": {${newline}${childIndent}${unit}${JSON.stringify(name)}: {}${newline}${childIndent}}`;
  const last = target.properties[target.properties.length - 1];
  const edit = last
    ? TextEdit.insert(
        document.positionAt(last.offset + last.length),
        `,${newline}${childIndent}${entry}`,
      )
    : TextEdit.replace(
        {
          start: document.positionAt(target.offset + 1),
          end: document.positionAt(target.offset + target.length - 1),
        },
        `${newline}${childIndent}${entry}${newline}${parentIndent}`,
      );

  return {
    title: `Add metadata for placeholder '${name}'`,
    kind: CodeActionKind.QuickFix,
    diagnostics: [diagnostic],
    edit: { changes: { [document.uri]: [edit] } },
  };
}
