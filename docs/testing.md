# Tests

- **Business** tests use in-memory fakes of the repositories
  (`createInMemoryDatabase`). The fakes throw where the app would deadlock.
- **Contract tests** (`repository-contract.ts`) run against the fakes and the
  real repositories. Add cases there for new repository methods.
- **Persistence** tests use `createTestDb()`: in-memory SQLite, opened and
  migrated like in the app.
- **Helpers** live in `__tests__/` of their layer; production code never
  imports from there.
- **Types:** Node types are available in test code only (`tsconfig.test.json`).
- **Time zone:** tests run in `Pacific/Pago_Pago` so that code using local time
  by mistake fails.
