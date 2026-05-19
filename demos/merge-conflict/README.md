# Scenario: Merge conflict recovery

Reproducible workflow for validating LatchOps against a merge conflict.

**Prerequisites:** LatchOps monorepo built (`pnpm install && pnpm build`), web running (`pnpm dev:web`).

1. Create a test repo and induce a conflict (add scripts here if you maintain them).
2. From the test repo root:

   ```bash
   # In the LatchOps monorepo root:
   pnpm cli snapshot --pretty
   # or, with web running:
   pnpm cli send --open
   ```

3. In the incident room, confirm:

   - Issue type: `merge_conflict`
   - Recovery tree with undo commands per step
   - Verify tab accepts a follow-up snapshot (`pnpm cli send` again)
