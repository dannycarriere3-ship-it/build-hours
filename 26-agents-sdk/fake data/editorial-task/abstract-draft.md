# Building Durable Agents That Finish The Work

Submitted public abstract - draft 2

Agents become useful when they do more than answer a prompt: they take
responsibility for a body of work over time. In this session, Priya Shah
explores the infrastructure behind long-running agent jobs, including durable
folders, boundaries between source materials and generated artifacts, and the
handoffs required when specialist agents collaborate. Drawing on Juniper Ridge
Systems' experiments in production tooling, she will discuss practical ways
to give agents real context without turning every workflow into a fragile
prompt chain.

The talk begins with workspace design. Attendees will see how documents,
images, source materials, outputs, and handoff records can be organized so a
fresh runtime understands the work it has inherited. Priya will then compare
local container execution with hosted compute for bursty workloads, showing
why stable agent instructions matter even when the execution environment
changes.

The closing section covers routing tasks, capturing review notes, escalating
uncertainty, persisting snapshots, and retaining enough evidence for a human
to approve the finished result. Attendees will leave with patterns for agents
that work cleanly across files, tools, and runtime boundaries, along with a
checklist for making agent work observable and reviewable inside a real
organization.

The session includes a live demonstration and extended audience Q&A covering
workflow design, concurrency, storage, security boundaries, cloud costs,
approval queues, accessibility checks, and the operational responsibilities
teams inherit when they begin to deploy agent systems in production.
