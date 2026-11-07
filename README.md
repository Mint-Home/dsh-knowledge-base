# Knowledge Base for DeepSeek Harness

A local, file-backed knowledge base plugin for [DeepSeek Harness](https://deepseek.com) (DSH).

Entries are stored as a single versionable JSON file; the plugin adds agent tools,
automatic context injection, and a rich sidebar panel with a tag-co-occurrence nebula.

![nebula](docs/nebula.png)

## Features

- **Structured entries** — title, content, summary, tags, source URL, timestamps.
- **Keyword retrieval** — BM25 scoring with title boost and CJK-aware tokenization
  (no embedding API required).
- **Agent tools** — `kb_search`, `kb_add`, `kb_capture`, `kb_list`, `kb_delete`, `kb_import`.
- **Automatic context injection (RAG)** — relevant entries are injected before each
  model turn (`agent/pre-step`), capped by count and character budget.
- **Sidebar panel** — tag explorer with progressive co-occurrence facets, entries list,
  bulk select/delete, detail/editor views.
- **Tag nebula** — force-directed graph of tags; node size and saturation encode usage,
  edge weight encodes co-occurrence, wheel zoom, middle-drag panning, right-click
  deletes a tag, draggable splitter resizes the rail.
- **Fully local** — no network calls; works offline.

## Requirements

- DeepSeek Harness `0.2.x`
- Node.js ≥ 18

## Install

```bash
dsh plugin install <path-to-this-repo>
```

Or add it to your profile's `cordis.patch.yml`:

```yaml
- insert:
    - id: knowledge-base
      name: "@local/knowledge-base"
```

The plugin registers itself as a bundle (`dsh.bundle.patch`) and mounts its web client
automatically (`dsh.client`).

## Configuration

All options are optional; sensible defaults are used:

| Option | Default | Description |
|---|---|---|
| `rootDir` | `~/.dsh-knowledge-base` | Directory that holds `entries.json` |
| `autoInject` | `true` | Inject relevant entries before each turn |
| `injectTop` | `5` | Max entries injected per turn |
| `injectChars` | `2000` | Character budget for injected context |
| `autoCaptureConfirm` | `true` | Ask for confirmation before `kb_capture` writes |

Example (`cordis.patch.yml`):

```yaml
- id: knowledge-base
  name: "@local/knowledge-base"
  config:
    rootDir: "/path/to/your/notes"
    injectTop: 8
```

The data directory is deliberately **not** part of this repository — the plugin is
stateless and works against any directory you point it at.

## Data format

`entries.json` is a plain JSON array of entries:

```json
[
  {
    "id": "…",
    "title": "Entry title",
    "content": "Full markdown-ish body",
    "summary": "One-line summary",
    "tags": ["关卡设计", "黑暗之魂"],
    "sourceUrl": "https://…",
    "status": "active",
    "createdAt": 1700000000000,
    "updatedAt": 1700000000000
  }
]
```

The file is safe to version with git.

## HTTP API

The sidebar panel talks to the host through `/kb-api`:

| Method | Path | Purpose |
|---|---|---|
| GET | `/kb-api/entries` | List entries |
| GET | `/kb-api/tags` | List tags with counts |
| GET | `/kb-api/explore?tags=a,b` | Co-occurrence facets + graph edges |
| POST | `/kb-api/entries` | Create an entry |
| PUT | `/kb-api/entries/:id` | Update an entry |
| DELETE | `/kb-api/entries/:id` | Delete an entry |
| POST | `/kb-api/entries/batch-delete` | Delete several entries |
| POST | `/kb-api/related-tags` | Suggest tags relevant to a text |
| DELETE | `/kb-api/tags/:name` | Remove a tag from every entry |
| POST | `/kb-api/import` | Bulk import Markdown / JSON |

## Development

```bash
node --check index.js
node --check client.js
```

After changing host code, reinstall the plugin (bundles are loaded at startup):

```bash
dsh plugin remove "@local/knowledge-base"
dsh plugin install <path-to-this-repo>
```

Client changes only need a browser hard refresh.

## License

MIT
