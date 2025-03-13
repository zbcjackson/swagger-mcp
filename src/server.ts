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
  console.log('handleSSE');
  if (!mcpServer) {
    console.log('mcpServer not initialized');
    res.status(400).json({ error: 'MCP server not initialized' });
    return;
  }
  mcpServer.handleSSE(res);
};

const handleMessage = async (req: Request, res: Response) => {
  console.log('handleMessage', req.body);
  if (!mcpServer) {
    console.log('mcpServer not initialized');
    res.status(400).json({ error: 'MCP server not initialized' });
    return;
  }
  mcpServer.handleMessage(req, res);
};

const handleHealth = (_req: Request, res: Response) => {
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
    // Load configuration
    const config = await loadConfig();
    
    // Create and initialize MCP server
    mcpServer = new SwaggerMcpServer(config.swagger.apiBaseUrl, config.swagger.defaultAuth);
    await mcpServer.loadSwaggerSpec(config.swagger.url);
    
    // Start the server
    app.listen(config.server.port, config.server.host, () => {
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