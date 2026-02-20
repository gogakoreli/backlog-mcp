# Research: source_path for backlog_create

## Current State

### backlog_create tool (`src/tools/backlog-create.ts`)
- Accepts: `title`, `description` (markdown string), `type`, `epic_id`, `parent_id`, `references`
- `description` is an optional string that becomes the markdown body of the task file
- Handler calls `createTask()` then `storage.add(task)`

### CreateTaskInput (`src/storage/schema.ts`)
- Already has `path?: string` field — metadata for artifacts pointing to external files
- Already has `content_type?: string` — MIME type for artifacts
- `createTask()` copies these fields onto the task object if present

### Artifact substrate (`src/substrates/index.ts`)
- `type: 'artifact'` with `content_type` and `path` fields
- Designed for file/resource entities attached to tasks/epics/folders

### Storage (`src/storage/task-storage.ts`)
- `add(task)` serializes task to YAML frontmatter + markdown body and writes to disk
- The `description` field becomes the markdown body below the frontmatter

## Problem
When an LLM agent wants to create a backlog artifact from a local file:
1. Agent reads file into context window (wasteful, lossy for large files)
2. Agent passes content as `description` string
3. Large files get truncated/summarized by the LLM

## Key Constraint
The backlog-mcp server runs locally with full filesystem access. It can read files directly — no need for content to transit through the LLM.

<insight>The change is minimal: add `source_path` to `backlog_create`, resolve it server-side to file content, use that as `description`. The `CreateTaskInput` interface already has `path` for metadata — `source_path` is the operational parameter that says "read from here", while `path` records where it came from.</insight>
