/**
 * Authentication API
 */

import type { VCRClient } from '../client';
import type {
  RegisterDto,
  LoginDto,
  RefreshTokenDto,
  AuthResponseDto,
} from '../types';

export class AuthAPI {
  constructor(private client: VCRClient) {}

  /**
   * Register a new user
   */
  async register(data: RegisterDto): Promise<AuthResponseDto> {
    const response = await this.client.post<AuthResponseDto>('/auth/register', data);
    return response;
  }

  /**
   * Login user
   */
  async login(data: LoginDto): Promise<AuthResponseDto> {
    const response = await this.client.post<AuthResponseDto>('/auth/login', data);
    return response;
  }

  /**
   * Refresh access token
   */
  async refreshTokens(data: RefreshTokenDto): Promise<AuthResponseDto> {
    const response = await this.client.post<AuthResponseDto>('/auth/refresh', data);
    return response;
  }

  /**
   * Logout user
   */
  async logout(): Promise<void> {
    await this.client.post('/auth/logout');
  }
}

