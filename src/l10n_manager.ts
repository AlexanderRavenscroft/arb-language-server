import { fileURLToPath } from "url";
import { InitializeParams } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { basename, dirname, extname, join, resolve } from "node:path";

export interface L10nConfiguration {
  readonly arbDirectory: string;
  readonly templateArbFile: string;
  readonly templateArbPath: string;
}

export class L10nManager {
  DEFAULT_ARB_DIRECTORY = "lib/l10n";
  DEFAULT_TEMPLATE_ARB_FILE = "app_en.arb";

  private currentConfiguration: L10nConfiguration | undefined;

  get configuration(): L10nConfiguration | undefined {
    return this.currentConfiguration;
  }

  async initialize(params: InitializeParams): Promise<void> {
    const rootUri = params.workspaceFolders?.[0]?.uri;

    if (rootUri?.startsWith("file:")) {
      await this.reloadConfig(fileURLToPath(rootUri));
    }
  }

  async handleWatchedFileChanges(
    changes: readonly { uri: string }[],
  ): Promise<boolean> {
    let shouldRevalidate = false;

    for (const change of changes) {
      if (!change.uri.startsWith("file:")) {
        continue;
      }

      const changedPath = resolve(fileURLToPath(change.uri));

      if (basename(changedPath) === "l10n.yaml") {
        await this.reloadConfig(dirname(changedPath));
        shouldRevalidate = true;
        continue;
      }

      if (changedPath === this.currentConfiguration?.templateArbPath) {
        shouldRevalidate = true;
      }
    }

    return shouldRevalidate;
  }

  isTemplateDocument(document: TextDocument): boolean {
    const configuration = this.currentConfiguration;

    if (!configuration || !document.uri.startsWith("file:")) {
      return false;
    }

    const documentPath = resolve(fileURLToPath(document.uri));

    return documentPath === configuration.templateArbPath;
  }

  isArbDocument(document: TextDocument): boolean {
    const configuration = this.currentConfiguration;

    if (!configuration || !document.uri.startsWith("file:")) {
      return false;
    }

    const documentPath = resolve(fileURLToPath(document.uri));

    return (
      extname(documentPath).toLowerCase() === ".arb" &&
      dirname(documentPath) === configuration.arbDirectory
    );
  }

  private async reloadConfig(projectRoot: string): Promise<void> {
    const configPath = join(projectRoot, "l10n.yaml");

    let content: string;

    try {
      content = await readFile(configPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.currentConfiguration = undefined;
        return;
      }

      throw error;
    }

    const parsed: unknown = parse(content);

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      this.currentConfiguration = undefined;
      return;
    }

    const config = parsed as Record<string, unknown>;
    const arbDirectoryValue = config["arb-dir"];
    const templateFileValue = config["template-arb-file"];

    if (
      (arbDirectoryValue !== undefined &&
        typeof arbDirectoryValue !== "string") ||
      (templateFileValue !== undefined && typeof templateFileValue !== "string")
    ) {
      this.currentConfiguration = undefined;
      return;
    }

    const configuredArbDirectory =
      arbDirectoryValue ?? this.DEFAULT_ARB_DIRECTORY;
    const templateArbFile = templateFileValue ?? this.DEFAULT_TEMPLATE_ARB_FILE;

    if (
      configuredArbDirectory.trim().length === 0 ||
      templateArbFile.trim().length === 0
    ) {
      this.currentConfiguration = undefined;
      return;
    }

    const arbDirectory = resolve(projectRoot, configuredArbDirectory);

    this.currentConfiguration = {
      arbDirectory,
      templateArbFile,
      templateArbPath: resolve(arbDirectory, templateArbFile),
    };
  }
}
