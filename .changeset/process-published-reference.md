---
"@cosyte/process": patch
---

The security-workflow trigger surface accepts the shared workflow at any published reference instead of `@main`: a caller's `uses` for `codeql.yml` and `scorecard.yml` is `cosyte/.github/.github/workflows/<file>@` followed by the commit a published `workflows-*` reference was cut from, or that reference's name. `@main` is now a finding, because it moves on cosyte/.github's clock rather than the caller's. The pattern is exported as `PUBLISHED_WORKFLOWS_REFERENCE`, and `SECURITY_WORKFLOW_SURFACES[...].job.uses` now names the workflow without a ref.
