/**
 * VCR SDK HTTP Client
 * Handles API requests with authentication
 */

export interface VCRClientConfig {
  baseUrl: string;
  apiKey?: string;
  accessToken?: string;
  timeout?: number;
  headers?: Record<string, string>;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
  headers?: Record<string, string>;
  body?: any;
  params?: Record<string, any>;
}

export class VCRClient {
  private config: VCRClientConfig;

  constructor(config: VCRClientConfig) {
    this.config = {
      timeout: 30000,
      ...config,
    };
  }

  /**
   * Make an HTTP request
   */
  async request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', headers = {}, body, params } = options;

    // Build URL with query parameters
    const url = new URL(endpoint, this.config.baseUrl);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          if (Array.isArray(value)) {
            value.forEach((v) => url.searchParams.append(key, String(v)));
          } else {
            url.searchParams.append(key, String(value));
          }
        }
      });
    }

    // Build headers
    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.config.headers,
      ...headers,
    };

    // Add authentication
    if (this.config.apiKey) {
      requestHeaders['x-api-key'] = this.config.apiKey;
    } else if (this.config.accessToken) {
      requestHeaders['Authorization'] = `Bearer ${this.config.accessToken}`;
    }

    // Build request options
    const fetchOptions: RequestInit = {
      method,
      headers: requestHeaders,
      signal: AbortSignal.timeout(this.config.timeout!),
    };

    if (body && method !== 'GET') {
      fetchOptions.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url.toString(), fetchOptions);

      // Handle non-JSON responses
      const contentType = response.headers.get('content-type');
      let data: any;

      if (contentType?.includes('application/json')) {
        data = await response.json();
      } else {
        data = await response.text();
      }

      if (!response.ok) {
        throw new VCRError(
          data?.message || `HTTP ${response.status}: ${response.statusText}`,
          response.status,
          data
        );
      }

      return data as T;
    } catch (error) {
      if (error instanceof VCRError) {
        throw error;
      }

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new VCRError('Request timeout', 408);
        }
        throw new VCRError(error.message, 0);
      }

      throw new VCRError('Unknown error occurred', 0);
    }
  }

  /**
   * GET request
   */
  async get<T>(endpoint: string, params?: Record<string, any>): Promise<T> {
    return this.request<T>(endpoint, { method: 'GET', params });
  }

  /**
   * POST request
   */
  async post<T>(endpoint: string, body?: any, params?: Record<string, any>): Promise<T> {
    return this.request<T>(endpoint, { method: 'POST', body, params });
  }

  /**
   * PATCH request
   */
  async patch<T>(endpoint: string, body?: any, params?: Record<string, any>): Promise<T> {
    return this.request<T>(endpoint, { method: 'PATCH', body, params });
  }

  /**
   * DELETE request
   */
  async delete<T>(endpoint: string, params?: Record<string, any>): Promise<T> {
    return this.request<T>(endpoint, { method: 'DELETE', params });
  }

  /**
   * PUT request
   */
  async put<T>(endpoint: string, body?: any, params?: Record<string, any>): Promise<T> {
    return this.request<T>(endpoint, { method: 'PUT', body, params });
  }

  /**
   * Update access token for bearer authentication
   */
  setAccessToken(token: string): void {
    this.config.accessToken = token;
  }

  /**
   * Update API key for API key authentication
   */
  setApiKey(apiKey: string): void {
    this.config.apiKey = apiKey;
  }

  /**
   * Get current configuration
   */
  getConfig(): Readonly<VCRClientConfig> {
    return { ...this.config };
  }
}

/**
 * Custom error class for VCR SDK
 */
export class VCRError extends Error {
  public statusCode: number;
  public data?: any;

  constructor(message: string, statusCode: number, data?: any) {
    super(message);
    this.name = 'VCRError';
    this.statusCode = statusCode;
    this.data = data;

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (typeof (Error as any).captureStackTrace === 'function') {
      (Error as any).captureStackTrace(this, VCRError);
    }
  }
}

