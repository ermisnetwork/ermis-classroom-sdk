/**
 * Basic Usage Example for VCR SDK
 *
 * This example demonstrates how to use the VCR SDK with API key authentication
 */

import { createVCRClient } from '../src';

async function main() {
  // Initialize SDK with API key
  const sdk = createVCRClient({
    baseUrl: 'http://localhost:3000/api',
    apiKey: 'your-api-key-here', // Replace with your actual API key
    debug: true,
  });

  try {
    // Example 1: List all events
    console.log('\n=== Listing Events ===');
    const events = await sdk.events.list({
      page: 1,
      limit: 10,
    });
    console.log('Events:', events);

    // Example 2: Create a new event
    console.log('\n=== Creating Event ===');
    const newEvent = await sdk.events.create({
      title: 'Sample Event',
      description: 'This is a sample event created via SDK',
      templateId: 'your-template-id', // Replace with actual template ID
      startTime: new Date(Date.now() + 86400000).toISOString(), // Tomorrow
      endTime: new Date(Date.now() + 90000000).toISOString(), // Tomorrow + 1 hour
      maxScore: 100,
      settings: {
        maxParticipants: 50,
        waitingRoomEnabled: true,
        recordingEnabled: true,
        chatEnabled: true,
      },
      tags: ['sdk-example', 'test'],
    });
    console.log('Created Event:', newEvent);

    // Example 3: Get event details
    if (newEvent.data._id) {
      console.log('\n=== Getting Event Details ===');
      const eventDetails = await sdk.events.get(newEvent.data._id);
      console.log('Event Details:', eventDetails);

      // Example 4: Create registrants
      console.log('\n=== Creating Registrant ===');
      const registrant = await sdk.events.createRegistrant(newEvent.data._id, {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        authId: 'student_001',
        role: 'student',
      });
      console.log('Created Registrant:', registrant);

      // Example 5: List registrants
      console.log('\n=== Listing Registrants ===');
      const registrants = await sdk.events.getRegistrants(newEvent.data._id, {
        page: 1,
        limit: 10,
      });
      console.log('Registrants:', registrants);
    }

    // Example 6: List templates
    console.log('\n=== Listing Templates ===');
    const templates = await sdk.templates.list({
      page: 1,
      limit: 10,
    });
    console.log('Templates:', templates);

    // Example 7: Get current user profile (requires bearer token)
    // This will fail with API key auth, but shows how to use it
    try {
      console.log('\n=== Getting User Profile ===');
      const profile = await sdk.users.getProfile();
      console.log('Profile:', profile);
    } catch (error) {
      console.log('Note: User profile requires bearer token authentication');
    }

  } catch (error) {
    console.error('Error:', error);
  }
}

// Run the example
main();

