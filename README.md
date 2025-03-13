# Swagger MCP Server

A TypeScript-based server that ingests and serves Swagger/OpenAPI specifications. This server can load Swagger specifications from either a file or URL and provides a unified interface for accessing the API documentation.

## Features

- Load Swagger/OpenAPI specifications from:
  - Local file
  - Remote URL
- Configure base URL for API endpoints
- Authentication support via:
  - Username/Password
  - API Token

## Setup

1. Install dependencies:
```bash
yarn install
```

2. Create environment file:
```bash
cp .env.example .env
```

3. Configure your environment variables in `.env`

## Development

Start the development server:
```bash
yarn dev
```

## Build

Build the project:
```bash
yarn build
```

## Production

Start the production server:
```bash
yarn start
```

## API Endpoints

### POST /api/swagger
Load a Swagger specification

Request body:
```json
{
  "swaggerFile": "path/to/file.json",  // Optional
  "swaggerUrl": "https://api.example.com/swagger.json",  // Optional
  "apiBaseUrl": "https://api.example.com"  // Required
}
```

Note: Either `swaggerFile` or `swaggerUrl` must be provided.

### GET /health
Health check endpoint

Response:
```json
{
  "status": "ok"
}
```

## Environment Variables

- `PORT`: Server port (default: 3000)
- `API_USERNAME`: Username for API authentication
- `API_PASSWORD`: Password for API authentication
- `API_TOKEN`: API token for authentication
- `DEFAULT_API_BASE_URL`: Default base URL for API endpoints
- `DEFAULT_SWAGGER_URL`: Default Swagger specification URL 