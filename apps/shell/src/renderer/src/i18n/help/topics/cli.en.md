# Command line and agents

Every install ships a `yiioffice` command that drives the same engines the window does — the same parsers, the same writer, the same renderer. A file the app saves and a file the command writes are the same file.

```sh
yiioffice --help          # every command
yiioffice guide slides    # the op reference, for writing your own
```

That is the whole surface in one screen — every command with a line saying what it does, then the global options and the exit codes:

![The real output of yiioffice --help: the version banner, every command with a one-line description, and the global options and exit codes](img/cli.png)

## Getting the command

macOS and Windows ship it inside the app bundle. To use it by name, run `yiioffice install-cli` once: it symlinks the bundled binary into `/usr/local/bin`, or into your user `PATH` on Windows.

## The commands worth knowing

| Command           | What it does                                                                                                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `open`            | Open a document in the app; starts the app if it is not running.                                                                                                                                                    |
| `selection`       | What the user has selected in that file right now, while the app is running — the pointer for "this one" / "here". Returns a block range, a sheet range, slide elements or a page, whichever editor the file is in. |
| `convert`         | Convert between formats using the app's own engines.                                                                                                                                                                |
| `create`          | Create a document from structured content.                                                                                                                                                                          |
| `render`          | One PNG per page, as the renderer lays it out.                                                                                                                                                                      |
| `pdf`             | Read a PDF's text layer page by page, with no app process.                                                                                                                                                          |
| `info`            | Metadata and a structure summary of a document.                                                                                                                                                                     |
| `search`          | Web or image search through the provider configured in the app.                                                                                                                                                     |
| `image` / `media` | Generate an image, or describe and ask questions about an image, video or audio file.                                                                                                                               |
| `merge`           | Fill `{{key}}` placeholders in a `.docx`, `.pptx` or `.xlsx` template.                                                                                                                                              |
| `capabilities`    | Report which cloud features are configured on this machine.                                                                                                                                                         |
| `guide`           | The op reference and design guides, generated from the same definitions the executor validates against — so it cannot drift from what `apply` accepts. `--json` returns it with each op's schema.                   |
| `install-cli`     | Put `yiioffice` on the `PATH`.                                                                                                                                                                                      |
| `skill`           | List the coding agents found on this machine and install or update the YiiOffice skill in them.                                                                                                                     |

## Editing: docs, sheets, slides

Each of `yiioffice docs`, `yiioffice sheet` and `yiioffice slides` takes a sub-command first — `read`, `apply`, `check`, and for slides `audit`, `render`, `replace` — and goes through the same write path the app uses. They share one vocabulary: an **op** is a single edit, and a **spec** is a list of ops applied in order.

```sh
yiioffice sheet read report.xlsx
yiioffice slides apply deck.pptx --ops ops.json --dry-run
yiioffice docs apply brief.docx --ops ops.json
```

`--dry-run` reports what a batch would do and writes nothing, which is the cheap way to check a spec before it lands.

## What the command does not do

It reads and writes the file. It is not the app: there is no window, and the in-app update dialog does not apply. `yiioffice render` gets you the pixels without it, and `yiioffice slides` audits a deck's layout on its own.
