/**
 * Pino-based logger with daily file rotation and pretty console output.
 *
 * Console: colorized, short timestamp (HH:MM:ss)
 * File:    plain text, full timestamp (yyyy-mm-dd HH:MM:ss), daily rotation
 */

const pino = require('pino');
const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(process.cwd(), 'logs');

function pad2(n) {
    return String(n).padStart(2, '0');
}

function getDateKey(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// Ensure log directory exists
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (_) { /* ignore */ }

const logFile = path.join(LOG_DIR, `${getDateKey(new Date())}.log`);

const logger = pino({
    level: 'debug',
    transport: {
        targets: [
            {
                target: 'pino-pretty',
                options: {
                    colorize: true,
                    translateTime: 'SYS:HH:MM:ss',
                    ignore: 'pid,hostname,tag',
                },
                level: 'debug',
            },
            {
                target: 'pino-pretty',
                options: {
                    colorize: false,
                    translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
                    ignore: 'pid,hostname,tag',
                    destination: logFile,
                    append: true,
                    mkdir: true,
                },
                level: 'debug',
            },
        ],
    },
});

// ============ Helper functions (backward-compatible API) ============

function log(tag, msg) {
    logger.info({ tag }, `[${tag}] ${msg}`);
}

function logWarn(tag, msg) {
    logger.warn({ tag }, `[${tag}] ⚠ ${msg}`);
}

function logError(tag, msg) {
    logger.error({ tag }, `[${tag}] ${msg}`);
}

function logDebug(tag, msg) {
    logger.debug({ tag }, `[${tag}] ${msg}`);
}

module.exports = {
    logger,
    log,
    logWarn,
    logError,
    logDebug,
};
