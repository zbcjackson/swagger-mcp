import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import axios, {AxiosInstance} from "axios";
import SwaggerParser from "@apidevtools/swagger-parser";
import {OpenAPI, OpenAPIV3 } from "openapi-types";
import { Request, Response } from 'express';
import { AuthConfig, ToolInput, SecurityScheme } from './types.js';

let transport: SSEServerTransport | null = null;

export class SwaggerMcpServer {
  private mcpServer: McpServer;
  private swaggerSpec: OpenAPI.Document | null = null;
  private apiBaseUrl: string;
  private defaultAuth: AuthConfig | undefined;
  private securitySchemes: Record<string, SecurityScheme> = {};
  private axios: AxiosInstance;
  private cookie: string | undefined;

  constructor(apiBaseUrl: string, defaultAuth?: AuthConfig) {
    console.debug('constructor', apiBaseUrl, defaultAuth);
    this.apiBaseUrl = apiBaseUrl;
    this.defaultAuth = defaultAuth;
    this.mcpServer = new McpServer({
      name: "Swagger API MCP Server",
      version: "1.0.0",
    });
    this.mcpServer.tool('test', 'test', {
      input: z.object({
        test: z.string(),
      }),
    }, async ({ input }) => {
      return { content: [{ type: "text", text: "Hello, world!" }] };
    });
    this.axios = axios.create({withCredentials: true, adapter: "fetch"});
    this.axios.interceptors.response.use(
        (response) => {
          const cookie = response.headers["set-cookie"] as unknown as string;
          if (cookie) {
            this.cookie = cookie;
          }
          return response;
        },
        (error) => Promise.reject(error),
    );
  }

  private getAuthHeaders(auth?: AuthConfig, operation?: OpenAPI.Operation): Record<string, string> {
    // Use provided auth or fall back to default auth
    const authConfig = auth || this.defaultAuth;
    if (!authConfig) return {};

    // // Check if operation requires specific security
    // const requiredSchemes = operation?.security || (this.swaggerSpec as any)?.security || [];
    // if (requiredSchemes.length === 0) return {};

    switch (authConfig.type) {
      case 'cookie':
        if (this.cookie) {
          return { 'Cookie': this.cookie! };
        }
        break;
      case 'basic':
        if (authConfig.username && authConfig.password) {
          const credentials = Buffer.from(`${authConfig.username}:${authConfig.password}`).toString('base64');
          return { 'Authorization': `Basic ${credentials}` };
        }
        break;
      case 'bearer':
        if (authConfig.token) {
          return { 'Authorization': `Bearer ${authConfig.token}` };
        }
        break;
      case 'apiKey':
        // For Petstore, we know the API key goes in header named 'api_key'
        if (authConfig.apiKey) {
          return { 'api_key': authConfig.apiKey };
        }
        break;
      case 'oauth2':
        if (authConfig.token) {
          return { 'Authorization': `Bearer ${authConfig.token}` };
        }
        break;
    }
    return {};
  }

  private getAuthQueryParams(auth?: AuthConfig): Record<string, string> {
    const authConfig = auth || this.defaultAuth;
    if (!authConfig) return {};

    if (authConfig.type === 'apiKey' && authConfig.apiKey && authConfig.apiKeyName && authConfig.apiKeyIn === 'query') {
      return { [authConfig.apiKeyName]: authConfig.apiKey };
    }

    return {};
  }

  private extractSecuritySchemes() {
    if (!this.swaggerSpec) return;

    // OpenAPI 3.x
    const components = (this.swaggerSpec as any).components;
    if (components && components.securitySchemes) {
      this.securitySchemes = components.securitySchemes;
      return;
    }

    // Swagger 2.0
    const securityDefinitions = (this.swaggerSpec as any).securityDefinitions;
    if (securityDefinitions) {
      this.securitySchemes = securityDefinitions;
    }
  }

  private createAuthSchema(operation?: OpenAPI.Operation): z.ZodType<any> {
    const authTypes: string[] = ['none'];  // Start with 'none' as default
    const authSchema: any = {};

    // Check operation-specific security requirements
    const requiredSchemes = operation?.security || (this.swaggerSpec as any)?.security || [];
    const requiredSchemeNames = new Set(
      requiredSchemes.flatMap((scheme: any) => Object.keys(scheme))
    );

    for (const [key, scheme] of Object.entries(this.securitySchemes)) {
      const securityScheme = scheme as SecurityScheme;
      const isRequired = requiredSchemeNames.has(key);

      switch (securityScheme.type) {
        case 'basic':
          authTypes.push('basic');
          if (isRequired || authTypes.length === 1) {
            authSchema.username = z.string();
            authSchema.password = z.string();
          } else {
            authSchema.username = z.string().optional();
            authSchema.password = z.string().optional();
          }
          break;
        case 'bearer':
        case 'http':
          if (securityScheme.scheme === 'bearer') {
            authTypes.push('bearer');
            authSchema.token = isRequired ? z.string() : z.string().optional();
          }
          break;
        case 'apiKey':
          authTypes.push('apiKey');
          if (isRequired || authTypes.length === 1) {
            authSchema.apiKey = z.string();
            if (securityScheme.in && securityScheme.name) {
              authSchema.apiKeyIn = z.enum(['header', 'query']).default(securityScheme.in as 'header' | 'query');
              authSchema.apiKeyName = z.string().default(securityScheme.name);
            }
          } else {
            authSchema.apiKey = z.string().optional();
            if (securityScheme.in && securityScheme.name) {
              authSchema.apiKeyIn = z.enum(['header', 'query']).optional().default(securityScheme.in as 'header' | 'query');
              authSchema.apiKeyName = z.string().optional().default(securityScheme.name);
            }
          }
          break;
        case 'oauth2':
          authTypes.push('oauth2');
          // Make token optional if API Key auth is available
          authSchema.token = isRequired && !authTypes.includes('apiKey') ? z.string() : z.string().optional();
          break;
      }
    }

    // Add all auth types to the enum - ensure we have at least 'none'
    authSchema.type = z.enum(authTypes as [string, ...string[]]);

    const description = `Authentication configuration. Available methods: ${authTypes.join(', ')}. ` +
      Object.entries(this.securitySchemes)
        .map(([key, scheme]) => {
          const desc = (scheme as SecurityScheme).description || scheme.type;
          const required = requiredSchemeNames.has(key) ? ' (Required)' : ' (Optional)';
          return `${key}: ${desc}${required}`;
        })
        .join('. ');

    return z.object(authSchema).describe(description);
  }

  async loadSwaggerSpec(specUrlOrFile: string) {
    console.debug('Loading Swagger specification from:', specUrlOrFile);
    try {
      // Add auth headers for fetching the swagger spec if needed
      const headers = this.getAuthHeaders();
      this.swaggerSpec = await SwaggerParser.parse(specUrlOrFile, {
        resolve: { http: { headers } }
      }) as OpenAPI.Document;
      
      const info = this.swaggerSpec.info;
      console.debug('Loaded Swagger spec:', {
        title: info.title,
        version: info.version,
        description: info.description?.substring(0, 100) + '...'
      });
      
      // Extract security schemes
      this.extractSecuritySchemes();
      console.debug('Security schemes found:', Object.keys(this.securitySchemes));
      
      // Update server name with API info
      this.mcpServer = new McpServer({
        name: info.title || "Swagger API Server",
        version: info.version || "1.0.0",
        description: info.description || undefined
      });

      await this.registerTools();
    } catch (error) {
      console.error("Failed to load Swagger specification:", error);
      throw error;
    }
  }

  private createZodSchema(parameter: OpenAPI.Parameter | OpenAPIV3.ReferenceObject | OpenAPIV3.SchemaObject ): z.ZodType {
    const schema = (parameter as any).schema || parameter;
    if (schema.$ref) {
        const ref = schema.$ref as string;
        const refParts = ref.replace(/^#\//, '').split('/');
        const resolvedSchema = refParts.reduce((obj: any, key) => obj[key], this.swaggerSpec!) as OpenAPIV3.SchemaObject;
        return this.createZodSchema(resolvedSchema);
    }

    let zodSchema: z.ZodType;
    switch (schema.type) {
      case 'string':
        zodSchema = z.string().describe(schema.description || '');
        break;
      case 'number':
        zodSchema = z.number().describe(schema.description || '');
        break;
      case 'integer':
        zodSchema =  z.number().int().describe(schema.description || '');
        break;
      case 'boolean':
        zodSchema = z.boolean().describe(schema.description || '');
        break;
      case 'array':
        zodSchema = z.array(this.createZodSchema(schema.items)).describe(schema.description || '');
        break;
      case 'object':
        if (schema.properties) {
          const shape: { [key: string]: z.ZodType<any> } = {};
          Object.entries(schema.properties).forEach(([key, prop]) => {
            shape[key] = this.createZodSchema(prop as OpenAPI.Parameter);
          });
          zodSchema = z.object(shape).describe(schema.description || '');
        } else {

          zodSchema = z.object({}).describe(schema.description || '');
        }
        break;
      default:
        zodSchema =  z.any().describe(schema.description || '');
        break;
    }
    if (!schema.required) {
      zodSchema = zodSchema.optional();
    }
    return zodSchema;
  }

  private async registerTools() {
    console.debug('Starting tool registration process');
    if (!this.swaggerSpec || !this.swaggerSpec.paths) {
      console.warn('No paths found in Swagger spec');
      return;
    }

    const totalPaths = Object.keys(this.swaggerSpec.paths).length;
    console.debug(`Found ${totalPaths} paths to process`);

    for (const [path, pathItem] of Object.entries(this.swaggerSpec.paths)) {
      if (!pathItem) continue;
      for (const [method, operation] of Object.entries(pathItem)) {
        if (method === '$ref' || !operation) continue;

        const op = operation as OpenAPI.Operation;
        const operationId = op.operationId || `${method}-${path}`;
        console.log(`Register endpoint: ${method.toUpperCase()} ${path} (${operationId})`);

        // Create input schema based on parameters
        const inputShape: { [key: string]: z.ZodType<any> } = {};
        const parameters = op.parameters || [];

        // Add auth parameters based on security schemes
        inputShape['auth'] = this.createAuthSchema(op);
        const requestBody = (operation as OpenAPIV3.OperationObject).requestBody as OpenAPIV3.RequestBodyObject
        if (['post', 'put', 'patch'].includes(method) && requestBody) {
          inputShape['requestBody'] = this.createZodSchema(requestBody.content?.['application/json']?.schema || {});
        }

        // Add API parameters
        parameters.forEach((param) => {
          if (param && 'name' in param && param.name) {
            inputShape[param.name] = this.createZodSchema(param);
          }
        });

        console.debug(`Registering tool: ${operationId}`, {
          parameters: Object.keys(inputShape),
          hasAuth: !!inputShape['auth']
        });

        // Register the tool
        this.mcpServer.tool(
          operationId,
          `${op.summary || `${method.toUpperCase()} ${path}`}\n\n${op.description || ''}`,
          {
            input: z.object(inputShape),
          },
          async ({ input }) => {
            console.debug(`Tool called: ${operationId}`, {
              params: Object.keys(input).filter(k => k !== 'auth'),
              hasAuth: !!input.auth
            });
            try {
              const { auth, requestBody, ...params } = input as ToolInput;
              console.debug('params', params);
              let url = this.apiBaseUrl + path;
              
              // Separate path parameters from query parameters
              const pathParams = new Set();
              path.split('/').forEach(segment => {
                if (segment.startsWith('{') && segment.endsWith('}')) {
                  pathParams.add(segment.slice(1, -1));
                }
              });

              // Replace path parameters
              Object.entries(params).forEach(([key, value]) => {
                if (pathParams.has(key)) {
                  url = url.replace(`{${key}}`, encodeURIComponent(String(value)));
                }
              });

              // Build query parameters object for GET requests
              const queryObject = method === 'get' ? 
                Object.entries(params)
                  .filter(([key]) => !pathParams.has(key))
                  .reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {})
                : {};

              const headers = {...this.getAuthHeaders(), ...(['post', 'put', 'patch'].includes(method) ? { 'Content-Type': 'application/json' } : {})};
              const queryParams = this.getAuthQueryParams(auth);

              console.debug('url', url);
              console.debug('method', method);
              console.debug('headers', headers);
              console.debug('params', params);
              console.debug('requestBody', requestBody);
              console.debug('queryParams', queryParams);
              
              const response = await this.axios({
                method: method as string,
                url: url,
                headers,
                data: method !== 'get' ? requestBody : undefined,
                params: { ...queryObject, ...queryParams },
                paramsSerializer: (params) => {
                  const searchParams = new URLSearchParams();
                  Object.entries(params).forEach(([key, value]) => {
                    if (Array.isArray(value)) {
                      // Handle arrays by adding multiple entries with the same key
                      value.forEach(v => searchParams.append(key, v));
                    } else {
                      searchParams.append(key, value as string);
                    }
                  });
                  return searchParams.toString();
                }
              });
              console.debug('response.headers', response.headers);
              console.debug('response.data', response.data);

              return {
                content: [
                  { type: "text", text: JSON.stringify(response.data, null, 2) },
                  // http status code
                  { type: "text", text: `HTTP Status Code: ${response.status}` },
                  // // http headers
                  // { type: "text", text: JSON.stringify(response.headers, null, 2) },
                ],
              };
            } catch (error) {
              console.error(`Error in ${operationId}:`, error);
              if (axios.isAxiosError(error) && error.response) {
                return {
                  content: [{ 
                    type: "text", text: `Error ${error.response.status}: ${JSON.stringify(error.response.data, null, 2)}` 
                  }],
                };
              }
              return {
                content: [{ type: "text", text: `Error: ${error}` }],
              };
            }
          }
        );
      }
    }
  }

  getServer() {
    return this.mcpServer;
  }

  handleSSE(res: Response) {
    console.debug('MCP handleSSE');
    transport = new SSEServerTransport("/messages", res);
    this.mcpServer.connect(transport);
  }

  handleMessage(req: Request, res: Response) {
    console.debug('MCP handleMessage', req.body);
    if (transport) {
      try {
        transport.handlePostMessage(req, res);
      } catch (error) {
        console.error('Error handling message:', error);
      }
    } else {
      console.warn('no transport');
    }
  }
}
