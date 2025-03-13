export interface SwaggerConfig {
  swaggerUrl?: string;
  swaggerFile?: string;
  apiBaseUrl: string;
  auth?: AuthConfig;
}

export interface AuthConfig {
  type: 'basic' | 'bearer' | 'apiKey' | 'oauth2';
  username?: string;
  password?: string;
  token?: string;
  apiKey?: string;
  apiKeyName?: string;
  apiKeyIn?: 'header' | 'query';
}

export interface ToolInput {
  auth?: AuthConfig;
  [key: string]: any;
}

export interface SecurityScheme {
  type: string;
  description?: string;
  name?: string;
  in?: string;
  scheme?: string;
  flows?: {
    implicit?: {
      authorizationUrl: string;
      scopes: Record<string, string>;
    };
    [key: string]: any;
  };
} 