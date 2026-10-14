# tidypepple-mcp

MCP server for [TidyPepple](https://github.com/MelBourbon/tidypepple): Claude and other AI
assistants or your own scripts read and edit your tasks.

The server runs on your machine and decrypts there. The TidyPepple server still sees only
encrypted data. **Whatever an assistant fetches, however, is seen by its provider.**

Sync must be enabled for your account (on app.tidypepple.com, that means a subscription).
Get the API token in the app under *Settings → API access*.

## Setup

**Claude Desktop:** download the `tidypepple.mcpb` extension from the app, double-click it
and paste the token.

**Claude Code:**

```bash
claude mcp add tidypepple --env TIDYPEPPLE_TOKEN=tp1.… -- npx -y tidypepple-mcp
```

**Other MCP clients** (Cursor, Windsurf, …):

```json
{
  "mcpServers": {
    "tidypepple": {
      "command": "npx",
      "args": ["-y", "tidypepple-mcp"],
      "env": { "TIDYPEPPLE_TOKEN": "tp1.…" }
    }
  }
}
```

| Variable | |
|---|---|
| `TIDYPEPPLE_TOKEN` | API token, required |
| `TIDYPEPPLE_ONLY_TAG` | Only show and edit tasks with this tag, e.g. `ai`. New tasks get the tag automatically. |
| `TIDYPEPPLE_SUPABASE_URL`, `TIDYPEPPLE_SUPABASE_ANON_KEY` | Only for self-hosted TidyPepple installations |

Node ≥ 20. The vault lives in memory only. At startup, the server loads everything and then
keeps itself up to date.

## Tools

Every tool returns `structuredContent` with a fixed schema, so scripts don't have to parse
text.

| Tool | |
|---|---|
| `list_tasks` | `view`: `actionable` (what's up now), `open` (default), `done`; filters `status`, `tag`, `context`, `project`, `query`, `limit` |
| `get_task` | One task with its steps |
| `list_projects`, `list_contexts`, `list_tags` | Overviews with the number of open tasks |
| `changes_since` | Changes since `cursor`, including those from other devices and deletions (`deleted: true`). With `reset: true`, the cursor was invalid (restart) and everything is returned. |
| `add_task` | The app's capture syntax: `Call Bob @phone +Moving #private !tomorrow >mon !!` |
| `update_task` | Change fields; `null` clears. `tags`/`contexts` replace, `addTags`/`removeTags` modify, `project` by name. |
| `complete_task`, `reopen_task`, `delete_task` | |

A read-only token only gets the reading tools.

## From scripts

Python (`pip install mcp`):

```python
import asyncio, os
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

params = StdioServerParameters(
    command="npx", args=["-y", "tidypepple-mcp"],
    env={**os.environ, "TIDYPEPPLE_TOKEN": os.environ["TIDYPEPPLE_TOKEN"]},
)

async def main():
    async with stdio_client(params) as (read, write), ClientSession(read, write) as session:
        await session.initialize()
        result = await session.call_tool("list_tasks", {"view": "actionable", "tag": "github"})
        for task in result.structuredContent["tasks"]:
            print(task["title"], task["dueDate"])
        await session.call_tool("add_task", {"text": "Pay invoice #finance !fri"})

asyncio.run(main())
```

TypeScript (`npm i @modelcontextprotocol/sdk`):

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const client = new Client({ name: 'my-script', version: '1.0.0' });
await client.connect(
  new StdioClientTransport({
    command: 'npx',
    args: ['-y', 'tidypepple-mcp'],
    env: { ...process.env, TIDYPEPPLE_TOKEN: process.env.TIDYPEPPLE_TOKEN! } as Record<string, string>,
  }),
);
const { structuredContent } = await client.callTool({ name: 'list_tasks', arguments: { tag: 'github' } });
```

A complete example that creates issues for tasks tagged `#github` and completes tasks whose
issues were closed is in [`examples/github_sync.py`](examples/github_sync.py).

**Mappings** (task ↔ issue, card …) are stored by the script itself, not in the task.

## License

AGPL-3.0, see [LICENSE](LICENSE).
