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
import { DidChangeWatchedFilesNotification } from "vscode-languageserver/node";
import { L10nManager } from "./l10n_manager";

const connection = createConnection(ProposedFeatures.all);
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);
let supportsFileWatching = false;

const l10nManager = new L10nManager();
let jsonService: JsonService | undefined;

connection.onInitialize(
  async (params: InitializeParams): Promise<InitializeResult> => {
    supportsFileWatching =
      params.capabilities.workspace?.didChangeWatchedFiles
        ?.dynamicRegistration === true;

    await l10nManager.initialize(params);

    jsonService = new JsonService(params.capabilities);

    return {
      capabilities: {
        textDocumentSync: {
          openClose: true,
          change: TextDocumentSyncKind.Incremental,
          save: true,
        },
        completionProvider: {
          resolveProvider: false,
          triggerCharacters: ['"', ":"],
        },
      },
    };
  },
);

connection.onInitialized(async () => {
  if (!supportsFileWatching) {
    connection.console.log("Client does not support dynamic file watching.");
    return;
  }

  try {
    await connection.client.register(DidChangeWatchedFilesNotification.type, {
      watchers: [{ globPattern: "**/l10n.yaml" }, { globPattern: "**/*.arb" }],
    });
  } catch (error) {
    connection.console.error(
      `Cannot register watcher: ${getErrorMessage(error)}`,
    );
  }
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
    l10nConfiguration: l10nManager.configuration,
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

connection.onDidChangeWatchedFiles(async ({ changes }) => {
  try {
    const shouldRevalidate =
      await l10nManager.handleWatchedFileChanges(changes);

    if (shouldRevalidate) {
      await Promise.all(documents.all().map(validateDocument));
    }
  } catch (error) {
    connection.console.error(
      `Cannot reload l10n.yaml: ${getErrorMessage(error)}`,
    );
  }
});

documents.onDidSave(async ({ document }) => {
  if (!l10nManager.isTemplateDocument(document)) {
    return;
  }

  await Promise.all(
    documents
      .all()
      .filter(
        (candidate) =>
          !l10nManager.isTemplateDocument(candidate) &&
          l10nManager.isArbDocument(candidate),
      )
      .map(validateDocument),
  );
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

documents.onDidClose(({ document }) => {
  connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
});

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

documents.listen(connection);
connection.listen();
