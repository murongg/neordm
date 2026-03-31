# AI Lua Tool Design

## Goal

Add a first-class AI tool that can execute Redis Lua scripts against the active connection without forcing the model to manually construct `EVAL` commands.

The first version will support:

- Inline Lua script text
- `KEYS`
- `ARGV`
- Optional human-readable reason
- Mandatory user confirmation before every execution

The first version will not support:

- `SCRIPT LOAD`
- `EVALSHA`
- Script caching or reuse
- Static write analysis of Lua scripts

## Why A Dedicated Tool

The existing AI tools expose generic Redis command execution, but `EVAL` and `EVALSHA` are not currently accepted by the AI command gating logic. Even if they were, they would be a poor fit for the model because the caller would need to correctly assemble:

- the command string
- shell-safe escaping
- `numkeys`
- the `KEYS` segment
- the `ARGV` segment

A dedicated tool gives the model a structured interface and lets the app execute Lua scripts through typed Redis APIs instead of string command parsing.

## Chosen Approach

Add a new AI tool named `runLuaScript`.

Parameters:

- `script: string` — required Lua source text
- `keys?: string[]` — optional Redis keys exposed to the script as `KEYS`
- `args?: string[]` — optional values exposed to the script as `ARGV`
- `reason?: string` — optional short explanation shown in the confirmation UI

Result shape:

- `script: string`
- `keys: string[]`
- `args: string[]`
- `output: string`

## Architecture

### AI Tool Layer

Update the AI tool registry in `src/lib/openai/constants.ts` and `src/lib/openai/tools.ts` to add `runLuaScript`.

Responsibilities:

- define the tool schema
- validate `script`, `keys`, and `args`
- require an active connection
- always request confirmation before execution
- call the Redis client helper
- return structured tool details so the AI runtime knows the operation may have mutated Redis

### Frontend Redis Helper

Add a new helper in `src/lib/redis.ts`:

- `runRedisLuaScript(connection, script, options?)`

Responsibilities:

- convert the active connection into the existing Tauri invoke payload shape
- send the script, keys, and args to a dedicated backend command
- return normalized textual output, reusing the same Redis CLI formatting helper path as much as possible

### Tauri Backend Command

Add a new Tauri command in Rust, exposed through the existing invoke handler.

Responsibilities:

- open the active Redis connection
- construct `redis::Script::new(script)`
- append `KEYS` and `ARGV` in order
- execute the script
- return formatted output text

This avoids encoding Lua execution as a shell-like Redis command string and avoids manual quoting bugs.

## Confirmation And Safety

`runLuaScript` will require explicit user confirmation on every call, regardless of script contents.

Reasoning:

- Lua scripts are difficult to classify safely from the client side
- A read-only-looking script can still mutate Redis
- A mandatory confirmation policy is simpler and more predictable than heuristics

The tool will reuse the existing dangerous-command confirmation flow:

- same pending confirmation state
- same approval / cancel actions
- same tool event lifecycle

The confirmation payload will contain:

- tool call id
- tool name
- a display string representing the Lua execution request
- optional reason

The display string will include:

- `KEYS` summary
- `ARGV` summary
- the full script body

## Data Flow

1. The model calls `runLuaScript`.
2. The AI tool layer validates arguments.
3. The AI tool layer asks for confirmation through `confirmDangerousCommand`.
4. If the user rejects, the tool returns an error.
5. If the user approves, the frontend helper invokes the new Tauri command.
6. The Rust backend executes the Lua script through `redis::Script`.
7. The result is formatted and returned to the AI runtime.
8. The AI runtime marks the operation as mutating Redis and refreshes keys / values after completion.

## Error Handling

Validation errors:

- empty script
- invalid non-array `keys`
- invalid non-array `args`

Runtime errors:

- no active connection
- user rejects confirmation
- Redis Lua execution failure
- backend invoke failure

The tool should return the backend error text without wrapping it in vague messaging so the assistant can explain the actual Redis failure.

## Testing Strategy

Use a minimal test-first check approach consistent with the repo's current script-based regression checks.

Add a new script that fails unless:

- `AI_TOOL_NAMES` includes `runLuaScript`
- the tool schema is registered in `createAssistantTools`
- the execution switch handles `runLuaScript`
- the execution path requests confirmation before calling the Redis Lua helper

After implementation:

- run the new Lua tool check
- run `pnpm build`

## Scope Boundaries

Explicitly out of scope for this change:

- Lua script history in the UI
- Syntax highlighting for Lua inside the confirmation panel
- Script SHA management
- Redis Functions support (`FUNCTION`, `FCALL`)
- Attempting to infer whether a script is read-only

## Implementation Notes

- Prefer adding a dedicated backend command instead of extending `run_redis_command`
- Reuse existing confirmation UI instead of adding Lua-specific UI state
- Mark the tool result as mutating Redis so post-tool refresh behavior stays conservative and correct
