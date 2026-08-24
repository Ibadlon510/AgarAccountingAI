---
name: Mutation scope contracts
description: OpenAPI code-generation constraint for mutation client or workspace scope.
---

When a generated mutation needs client or workspace scope, model that scope in a named request-body schema rather than as an operation query parameter.

**Why:** A query parameter on a mutation with a path parameter can make the generated TypeScript parameter type collide with the generated Zod path-parameter schema in the shared barrel.

**How to apply:** Define an entity-shaped input component (for example, `JournalEntryActionInput`) and pass it as the operation request body. Run codegen and the shared-library typecheck immediately after changing the contract.