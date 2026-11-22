# READ FIRST — what this repo is, and what it is not

This note exists because AI assistants keep mixing this repository up with other systems. Read it before diagnosing anything.

## What this repo is
- A fork of OpenAI's Build Hours demo code (numbered example folders), plus Danny Carriere's own addition: `28-roof-watcher-sales-agent`.
- Public demo / share code. Nothing in here runs in production.

## What this repo is NOT
- It is NOT MastersCodex. No MastersCodex source lives here.
- There is NO database here — no SQLite, no WAL, no server, no systemd services, no worker units, no B2B prospect pipeline.
- Do not ask Danny to run terminal, Termux, or journalctl commands against this repo. There is nothing here for them to find.

## Where the real systems live
- MastersCodex (the agent system with 40 workers and a self-training loop) runs on a separate private machine Danny controls through his personal AI agent. Its lesson store is a plain JSONL text file (88,551 lessons as of Nov 22, 2026), not SQLite. Its training loop runs as a systemd service named mcx-selftrain.service on that machine only.
- Danny's sales pipeline is Pipedrive (a hosted CRM), not code in this repo.
- If you need information about MastersCodex or the pipeline, ask Danny — he can get it from the machine where it actually runs. Do not invent plumbing, file formats, or services that you cannot see in this repo.
