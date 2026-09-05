# ARB Language Server

A Language Server Protocol (LSP) server for Flutter Application Resource Bundle (`.arb`) localization files. Provides JSON and ARB diagnostics, schema-based completions, and checks against a project's template ARB file.

The server runs locally using Node.js and communicates with an editor over standard input/output (`--stdio`).

## Features

- JSON syntax validation, including errors for comments and trailing commas.
- ARB structure validation and completions using the schema shipped in `schemas/arb.json`. The schema requires `@@locale`.
- Diagnostics for invalid message keys and metadata that references a missing message.
- Template diagnostics for missing message metadata, invalid placeholder names, placeholders without metadata, and unused placeholder metadata.
- Warnings for translation files missing messages present in the saved template file.

Template and translation checks use the project's `l10n.yaml`. Basic JSON/schema validation and message-key checks also work without that configuration.

## Requirements and editor setup

- Node.js 18 or newer, as declared by the package.
- An editor or LSP client that can start a Node.js process using `--stdio`.

For Zed integration, see the [ARB extension](https://github.com/AlexanderRavenscroft/arb). Its installer manages the server package and launches it using Zed's Node.js runtime.

For a manual npm installation, once the package is published:

```sh
npm install arb-language-server
node node_modules/arb-language-server/out/server.js --stdio
```

Configure your editor to run Node.js with the **absolute path** to the installed `out/server.js`, followed by `--stdio`, for `.arb` files. The Zed integration sends `json` as the LSP document language ID. The package currently has no command-line `bin` entry; launch the script directly.

Running the command in a terminal waits for LSP messages. It does not open an interactive interface.

## Project configuration

Place `l10n.yaml` at the root of the Flutter project and open that directory as your editor workspace. For example:

```yaml
arb-dir: lib/l10n
template-arb-file: app_en.arb
use-escaping: false
relax-syntax: false
required-resource-attributes: false
```

These are the settings currently read by the server:

| Setting                        | Default      | Behavior                                                                                                           |
| ------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------ |
| `arb-dir`                      | `lib/l10n`   | ARB directory, resolved relative to the directory containing `l10n.yaml`.                                          |
| `template-arb-file`            | `app_en.arb` | Template filename, resolved relative to `arb-dir`.                                                                 |
| `use-escaping`                 | `false`      | Handles apostrophe-escaped braces when scanning placeholders.                                                      |
| `relax-syntax`                 | `false`      | Recognizes brace expressions as placeholders only when their names are valid and declared in the message metadata. |
| `required-resource-attributes` | `false`      | Reports missing template message metadata as an error when enabled; otherwise reports it as information.           |

Defaults apply to omitted settings in a valid YAML mapping. Without a valid configuration, template-dependent checks are disabled. Other Flutter localization settings are not interpreted by this server.

A template message with placeholder metadata:

```json
{
  "@@locale": "en",
  "greeting": "Hello, {name}!",
  "@greeting": {
    "description": "Greeting shown to the user",
    "placeholders": {
      "name": {
        "type": "String",
        "example": "Alex"
      }
    }
  }
}
```

When the client supports dynamic file watching, the server registers watchers for `l10n.yaml` and `.arb` files and revalidates open documents after relevant configuration or template changes. Saving an open template also revalidates open translation files in the configured ARB directory.

## Current scope

- Initial configuration is loaded from the first workspace folder supplied by the client. Multiple independent project configurations in one server instance are not supported.
- Missing-message checks apply to files directly inside `arb-dir` and read the template from disk. Save template edits before expecting them to affect translations. These checks are skipped if the template cannot be read or parsed.
- Placeholder consistency checks run on the configured template file. Placeholder scanning handles simple arguments and nested `plural`, `select`, and `gender` branches; it is not a complete ICU message validator.
- The server currently provides diagnostics and completions. It does not provide formatting, semantic tokens, rename, hover, or code actions, and does not generate Flutter localization code.

## Development

From the repository root:

```sh
npm ci
npm run compile
node out/server.js --stdio
```

Use `npm run watch` to recompile while editing. Restart the language server to load updated JavaScript.

The ARB schema is maintained in `schemas/arb.json` and packaged with the server. Editor extensions do not need a separate schema copy.

## Packaging

```sh
npm pack --dry-run
npm pack
```

The `prepack` script deletes old `out/` files and compiles the current source with incremental compilation disabled. The package includes `out/` and `schemas/`; npm also includes the package manifest and README, plus the license file when present.

Do not commit `out/`, `node_modules/`, TypeScript build information, or generated `.tgz` archives. Commit source files, the schema, package manifests, and documentation. Test the packaged server before publishing a new npm version.

## License

MIT.
