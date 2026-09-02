import {
  createConnection,
  InitializeParams,
  InitializeResult,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { collectArbDiagnostics } from "./arb_diagnostics";
import { JsonService } from "./json_language_service";

const connection = createConnection(ProposedFeatures.all);
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let jsonService: JsonService | undefined;

connection.onInitialize((params: InitializeParams): InitializeResult => {
  jsonService = new JsonService(params.capabilities);

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        resolveProvider: false,
        triggerCharacters: ['"', ":"],
      },
    },
  };
});

async function validateDocument(document: TextDocument): Promise<void> {
  const service = jsonService;
  if (!service) {
    return;
  }

  const validatedVersion = document.version;
  const jsonDocument = service.getJsonDocument(document);

  const jsonDiagnosticsPromise = service
    .validate(document, jsonDocument)
    .catch((error: unknown) => {
      connection.console.error(
        `JSON validation failed for ${document.uri}: ${getErrorMessage(error)}`,
      );
      return [];
    });

  const arbDiagnosticsPromise = collectArbDiagnostics({
    document,
    jsonDocument,
  }).catch((error: unknown) => {
    connection.console.error(
      `ARB validation failed for ${document.uri}: ${getErrorMessage(error)}`,
    );
    return [];
  });

  const [jsonDiagnostics, arbDiagnostics] = await Promise.all([
    jsonDiagnosticsPromise,
    arbDiagnosticsPromise,
  ]);

  const currentDocument = documents.get(document.uri);
  if (!currentDocument || currentDocument.version !== validatedVersion) {
    return;
  }

  connection.sendDiagnostics({
    uri: document.uri,
    version: validatedVersion,
    diagnostics: [...jsonDiagnostics, ...arbDiagnostics],
  });
}

documents.onDidChangeContent(({ document }) => {
  void validateDocument(document);
});

documents.onDidClose(({ document }) => {
  connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
});

connection.onCompletion(async (params) => {
  const service = jsonService;
  const document = documents.get(params.textDocument.uri);

  if (!service || !document) {
    return null;
  }

  try {
    return await service.complete(document, params.position);
  } catch (error: unknown) {
    connection.console.error(
      `JSON completion failed for ${document.uri}: ${getErrorMessage(error)}`,
    );
    return null;
  }
});

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

documents.listen(connection);
connection.listen();
