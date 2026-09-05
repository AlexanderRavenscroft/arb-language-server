# ARB Language Server

A Language Server Protocol (LSP) server for Flutter Application Resource Bundle (`.arb`) files. Provides diagnostics, schema-based completions, and metadata quick fixes over standard input/output (`--stdio`).

## Features

- JSON syntax validation, including errors for comments and trailing commas.
- ARB structure validation and completions using the schema shipped in `schemas/arb.json`. The schema requires `@@locale`.
- Diagnostics for invalid message keys and metadata that references a missing message.
- Template diagnostics for missing message metadata, invalid placeholder names, placeholders without metadata, and unused placeholder metadata.
- Warnings for translation files missing messages present in the saved template file.
- Quick fixes for missing message and placeholder metadata.

Template and translation checks use the project's `l10n.yaml`. Basic JSON/schema validation and message-key checks also work without that configuration.

## Quick fixes

| Action                                  | Behavior                                                                            |
| --------------------------------------- | ----------------------------------------------------------------------------------- |
| **Add metadata for key 'foo'**          | Inserts `"@foo": {}` immediately after the message.                                 |
| **Add metadata for placeholder 'name'** | Adds `"name": {}` to an existing `@foo` block, creating `placeholders` when needed. |

Quick fixes preserve detected indentation and line endings and are unavailable while the document contains invalid JSON. If message metadata is missing, add it first, then add placeholder metadata.

## Requirements and editor setup

- Node.js 18 or newer, as declared by the package.
- An editor or LSP client that can start a Node.js process using `--stdio`.

For Zed integration, see the [ARB extension](https://github.com/AlexanderRavenscroft/arb). Its installer manages the server package and launches it using Zed's Node.js runtime.

For manual installation:

```sh
npm install arb-language-server
node node_modules/arb-language-server/out/server.js --stdio
```

Configure your editor to run Node.js with the **absolute path** to the installed `out/server.js`, followed by `--stdio`, for `.arb` files. There is no command-line `bin` entry; launch the script directly.

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

| Setting                        | Default      | Behavior                                                                         |
| ------------------------------ | ------------ | -------------------------------------------------------------------------------- |
| `arb-dir`                      | `lib/l10n`   | ARB directory relative to `l10n.yaml`.                                           |
| `template-arb-file`            | `app_en.arb` | Template filename relative to `arb-dir`.                                         |
| `use-escaping`                 | `false`      | Handles apostrophe-escaped braces when scanning placeholders.                    |
| `relax-syntax`                 | `false`      | Recognizes only valid placeholders declared in message metadata.                 |
| `required-resource-attributes` | `false`      | Makes missing template metadata an error instead of an informational diagnostic. |

Defaults apply to omitted settings in a valid YAML mapping. Without `l10n.yaml`, template-dependent checks are disabled. Other Flutter localization settings are not interpreted.

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

Configuration and template changes trigger revalidation when the client supports dynamic file watching. Saving an open template also revalidates open translations.

## Current scope

- Open one Flutter project at its root. Configuration is loaded from the first workspace folder; multiple or nested project configurations are not supported.
- Keep `l10n.yaml` valid: malformed YAML can prevent server initialization. Correct it and restart the server if startup fails.
- Missing-message checks apply to files directly inside `arb-dir` and read the template from disk. Save template edits before expecting them to affect translations. These checks are skipped if the template cannot be read or parsed.
- Placeholder consistency checks run on the configured template file. Placeholder scanning handles simple arguments and nested `plural`, `select`, and `gender` branches; it is not a complete ICU message validator.
- No ICU-specific highlighting, formatting, semantic tokens, rename, hover, or Flutter localization code generation.

## Development

From the repository root:

```sh
npm ci
npm run compile
node out/server.js --stdio
```

Use `npm run watch` to recompile while editing. Restart the language server to load updated JavaScript.

## Packaging and releases

```sh
npm pack --dry-run
npm pack
```

Both commands run `prepack`, which cleans `out/` and compiles from source. The package includes compiled JavaScript, the ARB schema, README, manifest, and license.

For an update, bump the version with `npm version <new-version> --no-git-tag-version`, then pack and test the resulting archive. Publish the tested archive with `npm publish ./arb-language-server-<new-version>.tgz`. Published versions cannot be overwritten.

Commit source and version changes; keep `out/`, `node_modules/`, build information, and `.tgz` archives out of Git. Zed extension releases are managed separately.

## License

MIT.
