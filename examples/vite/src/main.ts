import { createSDK, type SDKConfig } from '@ermisnetwork/ermis-classroom-sdk';

// Initialize the SDK
const config: SDKConfig = {
  apiKey: 'demo-api-key-12345',
  debug: true,
};

const sdk = createSDK(config);

// DOM elements
const statusEl = document.getElementById('status')!;
const inputEl = document.getElementById('input') as HTMLInputElement;
const processBtn = document.getElementById('processBtn') as HTMLButtonElement;
const outputEl = document.getElementById('output')!;
const configEl = document.getElementById('config')!;

// Initialize SDK
async function initializeSDK() {
  try {
    await sdk.init();
    statusEl.textContent = 'Initialized';
    statusEl.className = 'status initialized';

    // Display config
    const currentConfig = sdk.getConfig();
    configEl.textContent = JSON.stringify(currentConfig, null, 2);
  } catch (error) {
    console.error('Failed to initialize SDK:', error);
    statusEl.textContent = 'Initialization Failed';
    statusEl.className = 'status not-initialized';
  }
}

// Process button handler
processBtn.addEventListener('click', async () => {
  const input = inputEl.value;
  if (!input) {
    outputEl.textContent = 'Please enter some text!';
    return;
  }

  try {
    processBtn.textContent = 'Processing...';
    processBtn.disabled = true;

    const result = await sdk.doSomething(input);
    outputEl.textContent = result;
  } catch (error) {
    outputEl.textContent = `Error: ${error}`;
  } finally {
    processBtn.textContent = 'Process with SDK';
    processBtn.disabled = false;
  }
});

// Initialize on load
initializeSDK();

console.log('🚀 Vite example loaded!');
console.log('SDK instance:', sdk);

