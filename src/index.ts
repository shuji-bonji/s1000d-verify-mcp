#!/usr/bin/env node
/**
 * s1000d-verify-mcp — エントリポイント。
 * MCP SDK v2 の serveStdio は接続ごとに factory からサーバを 1 つ作る。組み立ては server.ts。
 */
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { buildServer } from './server.js';
import { PACKAGE_INFO } from './config.js';
import { logger } from './utils/logger.js';

serveStdio(() => buildServer(), {
  onerror: (error) => {
    logger.error('Server', error.message, error);
  },
});

logger.info('Server', `${PACKAGE_INFO.name} ${PACKAGE_INFO.version} started`);
