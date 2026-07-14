import { config } from './config.js';
import { logger } from './log.js';
import { createProxyServer } from './server.js';

const server = createProxyServer();

server.listen(config.port, () => {
  logger.info('server.listening', {
    port: config.port,
    upstream: config.upstreamBaseUrl,
    obfuscationEnabled: config.obfuscationEnabled,
  });
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    logger.info('server.shutting_down', { signal });
    server.close(() => process.exit(0));
  });
}
