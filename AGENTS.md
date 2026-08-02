# MasterSelects Agent Architecture Rule

Before changing AI-agent capabilities, read
[`docs/architecture/ADR-001-Fast-V2-Kernel-Owned-Orchestration.md`](docs/architecture/ADR-001-Fast-V2-Kernel-Owned-Orchestration.md).

Provider prompts, categories, fast paths, orchestration, sequencing, retries,
and intent-to-operation compilers belong in the private sibling repository
`masterselects-kernel`. This public editor may add atomic tools and must retain
their schemas, policy, authorization, confirmation, undo/transaction handling,
and deterministic execution. Do not add a provider-facing public fast path when
existing atomic tools can be composed privately in the kernel. Public
Cloudflare/D1 routes may validate and relay the pinned operation boundary, but
must not contain model orchestration or fast-path logic.
