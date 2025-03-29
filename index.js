const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { initTracer } = require('jaeger-client');
const promBundle = require('express-prom-bundle');
const winston = require('winston');
const LokiTransport = require('winston-loki');
const promClient = require('prom-client');

const app = express();
const port = 8000;

// Prometheus Metrics
const register = new promClient.Registry();
const requestLatency = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.1, 0.5, 1, 2, 5, 10],
  registers: [register],
});
const errorCounter = new promClient.Counter({
  name: 'http_request_errors_total',
  help: 'Total number of HTTP request errors',
  labelNames: ['method', 'route'],
  registers: [register],
});
const requestCounter = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route'],
  registers: [register],
});
const dbQueryLatency = new promClient.Histogram({
  name: 'db_query_duration_seconds',
  help: 'Duration of database queries in seconds',
  labelNames: ['query'],
  buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 1],
  registers: [register],
});
const dbQueryCounter = new promClient.Counter({
  name: 'db_query_count',
  help: 'Total number of database queries',
  labelNames: ['query'],
  registers: [register],
});

const metricsMiddleware = promBundle({
  includeMethod: true,
  includePath: true,
  includeStatusCode: true,
  promClient: {
    collectDefaultMetrics: {},
    registry: register,
  },
});
app.use(metricsMiddleware);

// Jaeger Tracing
const config = {
  serviceName: 'node-demo-app',
  sampler: {
    type: 'const',
    param: 1,
  },
  reporter: {
    logSpans: true,
    agentHost: 'localhost',
    agentPort: 6832,
  },
};
const options = {
  tags: {
    'node.js.version': process.versions.node,
  },
};
const tracer = initTracer(config, options);

// Loki Logging
const logger = winston.createLogger({
  transports: [
    new LokiTransport({
      host: 'http://loki:3100',
      labels: { app: 'node-demo-app' },
      json: true,
      format: winston.format.json(),
    }),
  ],
});

// Simulate Database Query Function
async function simulateDbQuery(query) {
  const startTime = Date.now();
  await new Promise((resolve) => setTimeout(resolve, Math.random() * 500)); // Simulate delay
  const duration = (Date.now() - startTime) / 1000;
  dbQueryLatency.labels(query).observe(duration);
  dbQueryCounter.inc({ query });
  return { result: 'database result' };
}

app.get('/api/data', async (req, res) => {
  const span = tracer.startSpan('get-data');
  const requestId = uuidv4();
  const startTime = Date.now();

  logger.info({ message: 'Request received', requestId, level: 'info' });
  requestCounter.inc({ method: req.method, route: req.route.path });

  try {
    span.log({ event: 'Fetching external data' });
    const externalRes = await axios.get('https://jsonplaceholder.typicode.com/todos/1');
    span.log({ event: 'External data fetched' });

    logger.info({ message: 'External data fetched', requestId, data: externalRes.data, level: 'info' });

    // Simulate Database Queries
    const dbResult1 = await simulateDbQuery('SELECT * FROM users');
    const dbResult2 = await simulateDbQuery('SELECT * FROM products');

    logger.info({ message: 'Database queries completed', requestId, level: 'info' });

    // Simulate External API Latency
    const externalApiLatency = Math.random() * 0.5; // Simulate latency
    logger.info({ message: 'External API call', requestId, externalApi: 'externalApiName', externalApiLatency: externalApiLatency, level: "info"});

    res.json({ data: externalRes.data, requestId });
    span.finish();
  } catch (error) {
    span.log({ event: 'Error fetching data', error: error.message });
    logger.error({ message: 'Error fetching data', requestId, error: error.message, level: 'error' });
    errorCounter.inc({ method: req.method, route: req.route.path });
    res.status(500).json({ error: 'Failed to fetch data', requestId });
    span.finish();
  } finally {
    const duration = (Date.now() - startTime) / 1000;
    requestLatency.labels(req.method, req.route.path, res.statusCode).observe(duration);
  }
});

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});