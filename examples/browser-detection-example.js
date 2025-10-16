/**
 * Example: Browser Detection & Transport Selection
 * This example demonstrates how the SDK automatically detects the browser
 * and selects the appropriate transport (WebRTC for Safari, WebTransport for others)
 */

import ErmisClassroom, { BrowserDetection } from 'ermis-classroom-sdk';

// 1. Check browser capabilities before connecting
console.log('=== Browser Capabilities ===');

// Check if current browser is Safari
if (BrowserDetection.isSafari()) {
  console.log('✅ Running on Safari - will use WebRTC');
} else {
  console.log('✅ Running on modern browser - will prefer WebTransport');
}

// Check if iOS Safari
if (BrowserDetection.isIOSSafari()) {
  console.log('📱 Running on iOS Safari');
}

// Check transport support
console.log('WebTransport Support:', BrowserDetection.isWebTransportSupported());
console.log('WebRTC Support:', BrowserDetection.isWebRTCSupported());

// Get recommended transport
const recommendation = BrowserDetection.determineTransport();
console.log('\n=== Recommended Transport ===');
console.log('Use WebRTC:', recommendation.useWebRTC);
console.log('Reason:', recommendation.reason);
console.log('Browser Info:', recommendation.browserInfo);

// 2. Create client - transport will be auto-selected
const client = ErmisClassroom.create({
  host: 'daibo.ermis.network:9993',
  debug: true,
});

// 3. Connect and join room
async function joinMeeting() {
  try {
    // Authenticate
    console.log('\n=== Authenticating ===');
    await client.authenticate('user@example.com');
    console.log('✅ Authenticated successfully');

    // Join room - SDK will automatically select transport
    console.log('\n=== Joining Room ===');
    const result = await client.joinRoom('your-room-code');
    
    // Check which transport was actually used
    const room = client.getCurrentRoom();
    const publisher = room?.localParticipant?.publisher;
    
    if (publisher) {
      console.log('\n=== Active Transport ===');
      console.log('Using WebRTC:', publisher.useWebRTC);
      
      if (publisher.useWebRTC) {
        console.log('✅ Connected via WebRTC');
      } else {
        console.log('✅ Connected via WebTransport');
      }
    }

    console.log('✅ Joined room successfully');
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// 4. Log detailed browser information
console.log('\n=== Detailed Browser Info ===');
const browserInfo = BrowserDetection.logTransportInfo();

// Export for use in other files
export { client, joinMeeting };
