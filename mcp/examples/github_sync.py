#!/usr/bin/env python3
"""
Beispiel: TidyPepple-Aufgaben mit dem Tag #github als GitHub-Issues führen.

- Offene Aufgabe mit #github und einem Projekt (+owner/repo) ohne Issue → Issue anlegen
- Issue geschlossen → Aufgabe erledigen
- Aufgabe erledigt → Issue schließen

Die Zuordnung Aufgabe ↔ Issue liegt in einer JSON-Datei neben dem Skript, nicht in der
Aufgabe: Ältere App-Versionen würden unbekannte Felder beim Speichern verwerfen.

    pip install mcp httpx
    export TIDYPEPPLE_TOKEN=tp1.…        # Token mit „Lesen und Schreiben“
    export GITHUB_TOKEN=ghp_…            # Scope: repo (bzw. Issues: read/write)
    python github_sync.py                # z. B. alle 10 Minuten per Cron

Das Repository steht als Projekt an der Aufgabe: „Bug fixen +MelBourbon/tidypepple #github“.
"""

import asyncio
import json
import os
from pathlib import Path

import httpx
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

TAG = "github"
STATE = Path(__file__).with_suffix(".state.json")
GITHUB = "https://api.github.com"


def load_state() -> dict[str, dict]:
    return json.loads(STATE.read_text()) if STATE.exists() else {}


def save_state(state: dict[str, dict]) -> None:
    STATE.write_text(json.dumps(state, indent=2))


async def call(session: ClientSession, tool: str, args: dict) -> dict:
    result = await session.call_tool(tool, args)
    if result.isError:
        raise RuntimeError(f"{tool}: {result.content}")
    return result.structuredContent


async def main() -> None:
    state = load_state()  # task_id → {"repo": "owner/name", "number": 42}
    github = httpx.AsyncClient(
        base_url=GITHUB,
        headers={"Authorization": f"Bearer {os.environ['GITHUB_TOKEN']}", "Accept": "application/vnd.github+json"},
    )
    params = StdioServerParameters(command="npx", args=["-y", "tidypepple-mcp"], env=dict(os.environ))

    async with stdio_client(params) as (read, write), ClientSession(read, write) as session:
        await session.initialize()

        # 1. Neue Aufgaben → Issues
        open_tasks = (await call(session, "list_tasks", {"tag": TAG, "limit": 500}))["tasks"]
        for task in open_tasks:
            if task["id"] in state or task["parent"] is None or "/" not in task["parent"]["title"]:
                continue
            repo = task["parent"]["title"]
            response = await github.post(f"/repos/{repo}/issues", json={"title": task["title"], "body": task["notes"]})
            response.raise_for_status()
            state[task["id"]] = {"repo": repo, "number": response.json()["number"]}
            print(f"Issue angelegt: {repo}#{state[task['id']]['number']} – {task['title']}")
            save_state(state)

        # 2. Abgleich des Status in beide Richtungen
        for task_id, link in list(state.items()):
            issue = (await github.get(f"/repos/{link['repo']}/issues/{link['number']}")).json()
            try:
                task = (await call(session, "get_task", {"id": task_id}))["task"]
            except RuntimeError:
                # Aufgabe gelöscht (oder Tag entfernt): Zuordnung vergessen, Issue bleibt.
                del state[task_id]
                continue

            if issue.get("state") == "closed" and task["status"] != "done":
                await call(session, "complete_task", {"id": task_id})
                print(f"Erledigt: {task['title']}")
            elif task["status"] == "done" and issue.get("state") == "open":
                await github.patch(f"/repos/{link['repo']}/issues/{link['number']}", json={"state": "closed"})
                print(f"Issue geschlossen: {link['repo']}#{link['number']}")

    save_state(state)
    await github.aclose()


if __name__ == "__main__":
    asyncio.run(main())
