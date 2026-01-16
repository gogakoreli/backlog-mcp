#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';

const DATA_DIR = process.env.BACKLOG_DATA_DIR || 'data';
const BACKLOG_JSON = join(DATA_DIR, 'backlog.json');
const ARCHIVE_JSON = join(DATA_DIR, 'archive.json');
const TASKS_DIR = join(DATA_DIR, 'tasks');
const ARCHIVE_DIR = join(DATA_DIR, 'archive');

function taskToMarkdown(task) {
  const { description, ...frontmatter } = task;
  return matter.stringify(description || '', frontmatter);
}

function migrateFile(jsonPath, outputDir) {
  if (!existsSync(jsonPath)) {
    console.log(`Skipping ${jsonPath} (doesn't exist)`);
    return 0;
  }

  const content = readFileSync(jsonPath, 'utf-8');
  const data = JSON.parse(content);

  if (!data.tasks || data.tasks.length === 0) {
    console.log(`No tasks in ${jsonPath}`);
    return 0;
  }

  mkdirSync(outputDir, { recursive: true });

  for (const task of data.tasks) {
    const markdown = taskToMarkdown(task);
    const filePath = join(outputDir, `${task.id}.md`);
    writeFileSync(filePath, markdown, 'utf-8');
    console.log(`✓ Migrated ${task.id}`);
  }

  return data.tasks.length;
}

console.log('Migrating backlog from JSON to Markdown...\n');

const activeCount = migrateFile(BACKLOG_JSON, TASKS_DIR);
const archivedCount = migrateFile(ARCHIVE_JSON, ARCHIVE_DIR);

console.log(`\n✅ Migration complete!`);
console.log(`   Active tasks: ${activeCount}`);
console.log(`   Archived tasks: ${archivedCount}`);
console.log(`\nOld JSON files are preserved. You can delete them manually if migration looks good.`);
