import { createServer, type Server } from 'node:http';

export function startHealthServer(port: number, isHealthy: () => boolean): Server {
  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      const healthy = isHealthy();
      response.writeHead(healthy ? 200 : 503, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ status: healthy ? 'ok' : 'unhealthy' }));
      return;
    }
    response.writeHead(404).end();
  });
  return server.listen(port);
}
