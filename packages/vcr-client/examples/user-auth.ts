/**
 * User Authentication Example for VCR SDK
 *
 * This example demonstrates how to use the VCR SDK with user authentication (bearer token)
 */

import { createVCRClient } from '../src';

async function main() {
  // Initialize SDK without authentication
  const sdk = createVCRClient({
    baseUrl: 'http://localhost:3000/api',
    debug: true,
  });

  try {
    // Example 1: Register a new user
    console.log('\n=== Registering New User ===');
    const registerResponse = await sdk.auth.register({
      email: 'newuser@example.com',
      password: 'SecurePassword123!',
      firstName: 'Jane',
      lastName: 'Smith',
    });
    console.log('Registration successful!');
    console.log('Access Token:', registerResponse.accessToken);

    // Set the access token for subsequent requests
    sdk.setAccessToken(registerResponse.accessToken);

    // Example 2: Get user profile
    console.log('\n=== Getting User Profile ===');
    const profile = await sdk.users.getProfile();
    console.log('User Profile:', profile);

    // Example 3: Update user profile
    console.log('\n=== Updating User Profile ===');
    const updatedProfile = await sdk.users.updateProfile({
      firstName: 'Jane Updated',
    });
    console.log('Updated Profile:', updatedProfile);

    // Example 4: Create an event as authenticated user
    console.log('\n=== Creating Event as User ===');
    const event = await sdk.events.create({
      title: 'My Personal Event',
      description: 'Event created by authenticated user',
      templateId: 'your-template-id', // Replace with actual template ID
      startTime: new Date(Date.now() + 86400000).toISOString(),
      endTime: new Date(Date.now() + 90000000).toISOString(),
      settings: {
        maxParticipants: 30,
      },
    });
    console.log('Created Event:', event);

    // Example 5: List my events
    console.log('\n=== Listing My Events ===');
    const myEvents = await sdk.events.list({
      page: 1,
      limit: 10,
    });
    console.log('My Events:', myEvents);

    // Example 6: Refresh tokens
    console.log('\n=== Refreshing Tokens ===');
    const refreshedTokens = await sdk.auth.refreshTokens({
      refreshToken: registerResponse.refreshToken,
    });
    console.log('Tokens refreshed successfully!');

    // Update with new access token
    sdk.setAccessToken(refreshedTokens.accessToken);

    // Example 7: Logout
    console.log('\n=== Logging Out ===');
    await sdk.auth.logout();
    console.log('Logged out successfully!');

    // Alternative: Login with existing credentials
    console.log('\n=== Logging In ===');
    const loginResponse = await sdk.auth.login({
      email: 'user@example.com',
      password: 'password123',
    });
    console.log('Login successful!');
    sdk.setAccessToken(loginResponse.accessToken);

  } catch (error) {
    console.error('Error:', error);
  }
}

// Run the example
main();

