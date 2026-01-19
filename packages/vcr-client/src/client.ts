/**
 * VCR SDK HTTP Client
 * Handles API requests with API Key authentication
 */

export type Language = 'vi' | 'en';

export interface VCRClientConfig {
  /**
   * API Key for authentication
   * Format: ak_<keyId>.<secret>
   * @example "ak_1234567890abcdef.a1b2c3d4e5f6789..."
   */
  apiKey: string;
  /**
   * Base URL of the VCR API
   * @default "https://api.vcr.example.com"
   */
  baseUrl?: string;
  /**
   * Request timeout in milliseconds
   * @default 30000
   */
  timeout?: number;
  /**
   * Additional headers to include in all requests
   */
  headers?: Record<string, string>;
  /**
   * Use Authorization header instead of x-api-key header
   * @default false (uses x-api-key header)
   */
  useAuthorizationHeader?: boolean;
  /**
   * Language for API responses (messages will be translated)
   * @default "vi" (Vietnamese)
   */
  language?: Language;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: any;
  params?: Record<string, any>;
  formData?: FormData; // For multipart/form-data requests
}

export class VCRHTTPClient {
  private config: Required<Omit<VCRClientConfig, 'headers'>> & Pick<VCRClientConfig, 'headers'>;

  constructor(config: VCRClientConfig) {
    if (!config.apiKey) {
      throw new Error('API Key is required');
    }

    this.config = {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl || 'https://api.vcr.example.com',
      timeout: config.timeout || 30000,
      useAuthorizationHeader: config.useAuthorizationHeader || false,
      language: config.language || 'vi',
      headers: config.headers,
    };
  }

  /**
   * Make an HTTP request
   */
  async request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', headers = {}, body, params, formData } = options;

    // Build URL with query parameters
    const url = new URL(endpoint, this.config.baseUrl);
    
    // Add language parameter (always add, even if params exist)
    url.searchParams.set('lang', this.config.language);
    
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
      ...this.config.headers,
      ...headers,
    };

    // Add authentication - prefer x-api-key header (recommended)
    if (this.config.useAuthorizationHeader) {
      requestHeaders['Authorization'] = `Bearer ${this.config.apiKey}`;
    } else {
      requestHeaders['x-api-key'] = this.config.apiKey;
    }

    // Only set Content-Type for JSON requests (not for FormData)
    if (!formData && !headers['Content-Type']) {
      requestHeaders['Content-Type'] = 'application/json';
    }

    // Build request options
    const fetchOptions: RequestInit = {
      method,
      headers: requestHeaders,
      signal: AbortSignal.timeout(this.config.timeout),
    };

    // Handle body - either FormData or JSON
    if (formData) {
      fetchOptions.body = formData;
    } else if (body && method !== 'GET') {
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
        // Map HTTP status codes to specific error types
        const errorMessage = data?.message || `HTTP ${response.status}: ${response.statusText}`;
        
        switch (response.status) {
          case 401:
            throw new AuthenticationError(errorMessage, data);
          case 403:
            throw new PermissionError(errorMessage, data);
          case 404:
            throw new NotFoundError(errorMessage, data);
          case 429:
            throw new RateLimitError(errorMessage, data);
          case 500:
          case 502:
          case 503:
          case 504:
            throw new ServerError(errorMessage, data);
          default:
            throw new VCRError(errorMessage, response.status, data);
        }
      }

      return data as T;
    } catch (error) {
      // Re-throw custom errors as-is
      if (
        error instanceof VCRError ||
        error instanceof AuthenticationError ||
        error instanceof PermissionError ||
        error instanceof NotFoundError ||
        error instanceof RateLimitError ||
        error instanceof ServerError
      ) {
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
   * POST request with FormData (for file uploads)
   */
  async postFormData<T>(endpoint: string, formData: FormData, params?: Record<string, any>): Promise<T> {
    return this.request<T>(endpoint, { method: 'POST', formData, params });
  }

  /**
   * PATCH request
   */
  async patch<T>(endpoint: string, body?: any, params?: Record<string, any>): Promise<T> {
    return this.request<T>(endpoint, { method: 'PATCH', body, params });
  }

  /**
   * PATCH request with FormData (for file uploads)
   */
  async patchFormData<T>(endpoint: string, formData: FormData, params?: Record<string, any>): Promise<T> {
    return this.request<T>(endpoint, { method: 'PATCH', formData, params });
  }

  /**
   * DELETE request
   */
  async delete<T>(endpoint: string, params?: Record<string, any>): Promise<T> {
    return this.request<T>(endpoint, { method: 'DELETE', params });
  }

  /**
   * Update API key
   */
  setApiKey(apiKey: string): void {
    this.config.apiKey = apiKey;
  }

  /**
   * Set language for all subsequent requests
   * @param language Language code ('vi' for Vietnamese, 'en' for English)
   */
  setLanguage(language: Language): void {
    this.config.language = language;
  }

  /**
   * Get current language
   */
  getLanguage(): Language {
    return this.config.language;
  }

  /**
   * Get current configuration (without sensitive data)
   */
  getConfig(): Omit<Readonly<VCRClientConfig>, 'apiKey'> & { hasApiKey: boolean } {
    return {
      baseUrl: this.config.baseUrl,
      timeout: this.config.timeout,
      useAuthorizationHeader: this.config.useAuthorizationHeader,
      language: this.config.language,
      headers: this.config.headers,
      hasApiKey: !!this.config.apiKey,
    };
  }
}

/**
 * Base error class for VCR SDK
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

/**
 * Authentication Error (401)
 * API Key không hợp lệ hoặc thiếu
 */
export class AuthenticationError extends VCRError {
  constructor(message: string, data?: any) {
    super(message, 401, data);
    this.name = 'AuthenticationError';
  }
}

/**
 * Permission Error (403)
 * 1. Thao tác resource không phải của mình
 * 2. Truy cập resource bị cấm (ngoài Event/Registrant/Reward)
 */
export class PermissionError extends VCRError {
  constructor(message: string, data?: any) {
    super(message, 403, data);
    this.name = 'PermissionError';
  }
}

/**
 * Not Found Error (404)
 * Resource không tồn tại
 */
export class NotFoundError extends VCRError {
  constructor(message: string, data?: any) {
    super(message, 404, data);
    this.name = 'NotFoundError';
  }
}

/**
 * Rate Limit Error (429)
 * Vượt quá rate limit
 */
export class RateLimitError extends VCRError {
  constructor(message: string, data?: any) {
    super(message, 429, data);
    this.name = 'RateLimitError';
  }
}

/**
 * Server Error (5xx)
 * Lỗi server VCR
 */
export class ServerError extends VCRError {
  constructor(message: string, data?: any) {
    super(message, 500, data);
    this.name = 'ServerError';
  }
}
