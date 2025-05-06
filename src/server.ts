import express, { Request, Response, Router } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { SwaggerMcpServer } from './mcp-server';
import { loadConfig } from './config';

// Load environment variables
dotenv.config();

const app = express();
const router = Router();
let mcpServer: SwaggerMcpServer | null = null;

// Middleware
// app.use(cors());
// app.use(express.json());

// Routes
const handleSSE = async (req: Request, res: Response) => {
  console.debug('SSE connection request received');
  if (!mcpServer) {
    console.warn('MCP server not initialized - rejecting SSE connection');
    res.status(400).json({ error: 'MCP server not initialized' });
    return;
  }
  console.debug('Establishing SSE connection...');
  mcpServer.handleSSE(res);
};

const handleMessage = async (req: Request, res: Response) => {
  console.debug('Message received:', {
    method: req.method,
    path: req.path,
    body: req.body
  });
  if (!mcpServer) {
    console.warn('MCP server not initialized - rejecting message');
    res.status(400).json({ error: 'MCP server not initialized' });
    return;
  }
  mcpServer.handleMessage(req, res);
};

const handleHealth = (_req: Request, res: Response) => {
  console.debug('Health check request received');
  res.json({ 
    status: 'ok',
    mcpServer: mcpServer ? 'initialized' : 'not initialized'
  });
};

// // Register routes
// router.get('/sse', handleSSE);
// router.post('/messages', handleMessage);
// router.get('/health', handleHealth);

// Mount router
// app.use('/', router);

app.get('/sse', handleSSE);
app.post('/messages', handleMessage);
app.get('/health', handleHealth);

// Initialize server
async function initializeServer() {
  try {
    console.log('Starting server initialization...');
    
    // Load configuration
    const config = await loadConfig();
    // set app logging level
    process.env.LOG_LEVEL = config.log?.level || 'info';

    console.debug('Configuration loaded:', {
      swaggerUrl: config.swagger.url,
      apiBaseUrl: config.swagger.apiBaseUrl,
      hasDefaultAuth: !!config.swagger.defaultAuth
    });
    
    // Create and initialize MCP server
    console.log('Creating MCP server instance...');
    mcpServer = new SwaggerMcpServer(config.swagger.apiBaseUrl, config.swagger.defaultAuth);
    
    console.log('Loading Swagger specification...');
    await mcpServer.loadSwaggerSpec(config.swagger.url);
    console.debug('Swagger specification loaded successfully');
    
    // Start the server
    app.listen(config.server.port, config.server.host, () => {
      console.log('Server initialization complete');
      console.log(`Server is running on http://${config.server.host}:${config.server.port}`);
      console.log('Swagger specification loaded from:', config.swagger.url);
      console.log('API Base URL:', config.swagger.apiBaseUrl);
    });
  } catch (error) {
    console.error('Failed to initialize server:', error);
    process.exit(1);
  }
}

// Start the server
initializeServer();