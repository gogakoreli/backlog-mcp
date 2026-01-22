#!/bin/bash
set -e

BACKLOG_DIR="${BACKLOG_DATA_DIR:-$HOME/Documents/goga/.backlog}"
TASKS_DIR="$BACKLOG_DIR/tasks"
ARCHIVE_DIR="$BACKLOG_DIR/archive"

echo "Migrating archive to tasks..."

# Handle TASK-0050 collision
if [ -f "$TASKS_DIR/TASK-0050.md" ] && [ -f "$ARCHIVE_DIR/TASK-0050.md" ]; then
  echo "Collision detected: TASK-0050 exists in both directories"
  echo "Renaming archived TASK-0050 to TASK-0051"
  mv "$ARCHIVE_DIR/TASK-0050.md" "$ARCHIVE_DIR/TASK-0051.md"
  # Update ID in frontmatter
  sed -i '' 's/^id: TASK-0050$/id: TASK-0051/' "$ARCHIVE_DIR/TASK-0051.md"
fi

# Move all archive files to tasks
if [ -d "$ARCHIVE_DIR" ]; then
  mv "$ARCHIVE_DIR"/*.md "$TASKS_DIR/" 2>/dev/null || true
  echo "Migration complete. Archive directory preserved for rollback."
  echo "After verifying, delete: rm -rf $ARCHIVE_DIR"
else
  echo "No archive directory found. Nothing to migrate."
fi
