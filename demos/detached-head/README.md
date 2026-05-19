# Scenario: Detached HEAD / rebase recovery

Reproducible workflow for detached HEAD and rebase-in-progress states.

**Prerequisites:** LatchOps monorepo built (`pnpm install && pnpm build`), web running (`pnpm dev:web`).

1. Detach HEAD or start a rebase and stop mid-flight in a test repository.
2. From the test repo, run from the LatchOps monorepo root:

   ```bash
   pnpm cli send --open
   ```

3. Confirm classification (`detached_head` or `rebase_in_progress`) and reflog-based rollback steps in the incident room.
