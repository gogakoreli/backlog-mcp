#!/usr/bin/env node
import { startViewer } from './viewer.js';

const port = parseInt(process.env.BACKLOG_VIEWER_PORT || '3030');
startViewer(port);
