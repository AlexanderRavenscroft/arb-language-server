import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ClientCapabilities,
  CompletionList,
  getLanguageService,
  JSONDocument,
  LanguageService,
  Position,
} from "vscode-json-languageservice";
import { Diagnostic, DiagnosticSeverity } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";

const schemaPath = path.resolve(__dirname, "..", "schemas", "arb.json");
const schemaUri = pathToFileURL(schemaPath).toString();

export class JsonService {
  private readonly languageService: LanguageService;

  public constructor(clientCapabilities: ClientCapabilities) {
    this.languageService = getLanguageService({
      clientCapabilities,
      schemaRequestService: loadSchema,
      workspaceContext: {
        resolveRelativePath: (relativePath, resource) =>
          new URL(relativePath, resource).toString(),
      },
    });

    this.languageService.configure({
      validate: true,
      allowComments: false,
      schemas: [
        {
          uri: schemaUri,
          fileMatch: ["*.arb"],
        },
      ],
    });
  }

  public getJsonDocument(document: TextDocument): JSONDocument {
    return this.languageService.parseJSONDocument(document);
  }

  public async validate(
    document: TextDocument,
    jsonDocument = this.getJsonDocument(document),
  ): Promise<Diagnostic[]> {
    const diagnostics = await this.languageService.doValidation(
      document,
      jsonDocument,
      {
        comments: "error",
        trailingCommas: "error",
        schemaValidation: "warning",
        schemaRequest: "warning",
      },
    );

    return diagnostics.map((diagnostic) => ({
      range: diagnostic.range,
      severity: diagnostic.severity as DiagnosticSeverity | undefined,
      code: diagnostic.code,
      source: diagnostic.source ?? "json",
      message:
        typeof diagnostic.message === "string"
          ? diagnostic.message
          : diagnostic.message.value,
    }));
  }

  public complete(
    document: TextDocument,
    position: Position,
  ): PromiseLike<CompletionList | null> {
    return this.languageService.doComplete(
      document,
      position,
      this.getJsonDocument(document),
    );
  }
}

async function loadSchema(uri: string): Promise<string> {
  const parsedUri = new URL(uri);
  if (parsedUri.protocol !== "file:") {
    throw new Error(`Unsupported schema URI protocol: ${parsedUri.protocol}`);
  }

  return readFile(fileURLToPath(parsedUri), "utf8");
}
