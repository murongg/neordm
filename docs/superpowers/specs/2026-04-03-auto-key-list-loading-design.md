# Automatic Key List Loading Strategy Design

## Summary

This design improves first paint performance for the Redis key browser while keeping the visible behavior stable. The target scenario is direct Redis connections with databases that typically contain at most 10,000 keys. The user goal is fast first paint with minimal visual change, and it is acceptable for the first paint to show key names before key type or TTL metadata is available.

The design introduces a session-scoped automatic strategy selector for key list loading. It chooses between cached-first loading, a small-database fast path, and the existing SCAN-based path. The choice is automatic and stable within a session so the UI does not oscillate between different behaviors.

For this iteration, "local cache" means an in-memory runtime cache owned by the frontend store. It speeds up repeated visits during the current app runtime and does not persist across app restarts.

## Goals

- Reduce time to first visible key list paint.
- Keep the key list visually stable.
- Preserve the current lightweight metadata model:
  - key type is filled asynchronously for visible rows
  - TTL is filled when key summary or key value is loaded
- Keep the system fully automatic with no user-facing toggle.

## Non-Goals

- Optimizing Redis Cluster key loading in this change.
- Changing the current type and TTL loading model.
- Reworking key browser UI structure or interaction patterns.
- Adding a user setting for strategy selection.

## Constraints

- The key browser must continue to avoid eager TYPE and TTL loading during SCAN page fetches.
- The first paint should avoid obvious list jumping or reorder churn.
- The strategy decision should remain stable during a connection+DB session.
- Any aggressive path must fail safely back to the existing SCAN path.

## Recommended Approach

Use a session-scoped automatic strategy selector with three direct-connection modes:

1. `direct-small-db-hot`
2. `direct-small-db-cold`
3. `direct-large-or-unknown`

The selector uses only stable signals:

- connection mode
- DBSIZE result
- whether a local cache exists for the current connection and DB
- recent first-paint timing history for the same connection and DB

Once selected for the current session, the strategy remains fixed until the active connection or selected DB changes.

## Strategy Definitions

### 1. direct-small-db-hot

Conditions:

- connection mode is direct
- `DBSIZE <= 10_000`
- a recent local cache exists for the same connection and DB

Behavior:

- paint the cached key names immediately
- start a background refresh
- keep the current async type loading for visible rows
- keep TTL loading on summary/value fetch only
- apply a single atomic list replacement when the refresh completes

This is the preferred path for repeated visits because it gives the fastest first paint and the least visible change.

### 2. direct-small-db-cold

Conditions:

- connection mode is direct
- `DBSIZE <= 10_000`
- no cache exists for the same connection and DB

Behavior:

- use a small-database fast path to fetch the full key name list once
- sort locally before committing the list
- after first paint, continue with the existing async type and TTL behavior

The fast path is intended to avoid progressive partial list construction for small databases when there is no cache available.

### 3. direct-large-or-unknown

Conditions:

- connection mode is direct
- `DBSIZE > 10_000`, or
- DBSIZE could not be obtained reliably

Behavior:

- use the current SCAN-based loading path
- raise the initial SCAN COUNT for first paint
- commit the first render as soon as the initial render threshold is satisfied
- continue incremental load-more behavior after first paint

This path preserves the current safety characteristics for larger or uncertain datasets.

## First-Paint Data Flow

### Cached path

1. Resolve session strategy.
2. Read cache for `connectionId + db`.
3. If cache exists and strategy is `direct-small-db-hot`, paint cached key names immediately.
4. Start background refresh.
5. When refresh succeeds, replace the full key list in one state update.
6. Preserve selected key and scroll position as much as current state allows.

### Small-database cold path

1. Resolve session strategy.
2. Confirm `DBSIZE <= 10_000`.
3. Fetch the full key name list using the fast path.
4. Sort the full list locally.
5. Commit a single first paint with key names only.
6. Continue visible-row type loading and selected-key summary/value loading.

### Large or unknown path

1. Resolve session strategy.
2. Start SCAN-based loading.
3. Use a higher initial SCAN COUNT than the current default.
4. Commit the first list render once the initial page is ready.
5. Keep the rest of the pagination and metadata behavior unchanged.

## State Design

Add three store-owned state groups.

### `keyListStrategySessions`

Purpose:

- store the selected strategy for the current connection+DB session

Key:

- `connectionId + db`

Fields:

- `strategy`
- `resolvedAt`
- `dbSizeSnapshot`

Rules:

- created on first load for a session
- discarded when connection or DB changes
- not recalculated again during the same session unless the session is reset

### `keyListCaches`

Purpose:

- provide immediate cached first paint for repeated visits

Key:

- `connectionId + db`

Fields:

- `keys`
- `fetchedAt`
- `dbSizeSnapshot`
- `strategyUsed`
- `firstPaintMs`

Rules:

- cache only key names and list-level data
- do not cache key type or TTL to avoid stale metadata presentation
- overwrite only on successful full-list completion

### `keyListPerfHints`

Purpose:

- retain lightweight historical signals to support future automatic strategy selection

Key:

- `connectionId + db`

Fields:

- recent first-paint timings
- recent full-load timings
- whether the fast path succeeded
- whether the fast path timed out or fell back
- recent DBSIZE snapshots

Rules:

- keep only a short history, such as the latest three successful runs
- use the data only for the next session decision, not for mid-session switching

## Backend Changes

Add a direct-connection small-database fast path API that returns key names only.

Requirements:

- direct connections only
- gated by `DBSIZE <= 10_000`
- bounded by timeout and safe error propagation
- implemented with a full key-name fetch path suitable only for small databases, such as `KEYS *`
- returns a complete key name list without type or TTL

The existing SCAN page API remains unchanged for large or unknown cases. Existing summary and value APIs remain unchanged for type and TTL backfill.

## Frontend Store Changes

Update key list loading orchestration in the workspace store:

- resolve strategy before loading keys
- use cached-first rendering when eligible
- use fast path only for `direct-small-db-cold`
- fall back to SCAN immediately on any fast-path failure
- record performance hints after each completed run
- keep current metadata loading paths unchanged

The user-visible key browser component should not need a behavior redesign. It should keep receiving a list of keys and continue triggering visible-row type backfill exactly as it does now.

## Fallback and Error Handling

### DBSIZE failure

- do not block first paint
- classify the session as `direct-large-or-unknown`
- use the SCAN path

### Fast-path failure or timeout

- abandon the fast path for the current session
- fall back immediately to SCAN
- record the failure in `keyListPerfHints`
- keep future strategy selection conservative for the same connection and DB

### Cached paint with refresh failure

- keep the cached list visible
- expose refresh failure through existing loading/error affordances
- do not clear the list on refresh failure

### Refresh result differs significantly from cache

- update the list in a single replacement
- preserve selected key if it still exists
- avoid multi-phase list mutation that would create visible churn

## UX Expectations

- The first paint should usually show key names only.
- Type badges may appear after the list is already visible.
- TTL should continue to appear after key summary or key content is fetched.
- The list should not visibly switch strategies within a session.
- Returning to the same direct small database should feel significantly faster than the first visit.

## Testing Plan

### Unit tests

- strategy selector chooses the correct mode from:
  - direct + small DB + cache
  - direct + small DB + no cache
  - direct + large DB
  - direct + unknown DB size
- failure history suppresses fast-path reuse when appropriate

### Store integration tests

- cached-first path paints cache before background refresh completes
- small-database cold path loads full key names without metadata
- fast path timeout falls back to SCAN
- DBSIZE failure falls back to SCAN
- selected key is preserved across atomic refresh replacement when possible

### Constraint checks

Preserve existing guarantees:

- SCAN page fetches must not eagerly request TYPE or TTL
- selected-key flow must still load summary before full content
- visible-row key type loading must remain asynchronous

Add a new check:

- small-database fast path must only be used for direct connections whose `DBSIZE <= 10_000`

## Rollout Plan

1. Add strategy state and selection logic.
2. Add local cache and performance-hint storage.
3. Add the backend small-database fast path.
4. Wire cached-first and fast-path behavior into `loadKeys`.
5. Add tests and invariant scripts.
6. Validate first-paint timing and visible stability locally.

## Open Decisions Resolved

- Automatic only: yes.
- Primary optimization target: first paint of the key name list.
- Visual stability priority: high.
- Accept first paint without type or TTL: yes.
- Direct Redis only in this iteration: yes.
- Small database threshold: `10_000` keys.

## Acceptance Criteria

- Re-entering the same direct small database can paint cached key names immediately.
- First paint for direct small databases does not require eager type or TTL fetching.
- The current visible-row type backfill and selected-key TTL backfill continue to work.
- Fast-path failure never leaves the key browser empty when SCAN fallback can proceed.
- Users do not see mid-session strategy switching for the same connection and DB.
