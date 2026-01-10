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
  });

  try {
    // Example 1: Create a new event
    console.log('\n=== Creating Event ===');
    const newEvent = await sdk.events.create({
      title: 'Sample Event',
      description: 'This is a sample event created via SDK',
      startTime: new Date(Date.now() + 86400000).toISOString(), // Tomorrow
      endTime: new Date(Date.now() + 90000000).toISOString(), // Tomorrow + 1 hour
      settings: {
        maxParticipants: 50,
        recordingEnabled: true,
        chatEnabled: true,
      },
      tags: ['sdk-example', 'test'],
    });
    console.log('Created Event:', newEvent);

    // Example 2: Get event details
    console.log('\n=== Getting Event Details ===');
    const eventDetails = await sdk.events.get(newEvent._id);
    console.log('Event Details:', eventDetails);

    // Example 3: Create a registrant
    console.log('\n=== Creating Registrant ===');
    const registrant = await sdk.registrants.create(newEvent._id, {
      firstName: 'John',
      lastName: 'Doe',
      email: 'john.doe@example.com',
      authId: 'student_001',
      role: 'student',
    });
    console.log('Created Registrant:', registrant);

    // Example 4: List registrants
    console.log('\n=== Listing Registrants ===');
    const registrants = await sdk.registrants.list(newEvent._id, {
      page: 1,
      limit: 10,
    });
    console.log('Registrants:', registrants);

    // Example 5: Bulk create registrants
    console.log('\n=== Bulk Creating Registrants ===');
    const bulkResult = await sdk.registrants.bulkCreate(newEvent._id, {
      registrants: [
        {
          firstName: 'Jane',
          lastName: 'Smith',
          email: 'jane.smith@example.com',
          authId: 'student_002',
          role: 'student',
        },
        {
          firstName: 'Bob',
          lastName: 'Johnson',
          email: 'bob.johnson@example.com',
          authId: 'student_003',
          role: 'student',
        },
      ],
    });
    console.log(`Bulk create result: ${bulkResult.created} created, ${bulkResult.failed} failed`);
    if (bulkResult.errors.length > 0) {
      console.log('Errors:', bulkResult.errors);
    }

    // Example 6: Get event ratings (read-only)
    console.log('\n=== Getting Event Ratings ===');
    const ratings = await sdk.ratings.list(newEvent._id);
    console.log(`Average ratings - Call: ${ratings.averageCallQuality}, Class: ${ratings.averageClassQuality}, Teacher: ${ratings.averageTeacher}`);

  } catch (error) {
    console.error('Error:', error);
  }
}

// Run the example
main();

