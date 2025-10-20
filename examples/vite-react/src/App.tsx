import { useState, useEffect } from 'react';
import { createSDK, type SDKConfig } from '@ermisnetwork/ermis-classroom-sdk';

function App() {
  const [sdk] = useState(() => createSDK({
    apiKey: 'demo-api-key-12345',
    debug: true,
  }));
  
  const [status, setStatus] = useState<'not-initialized' | 'initialized' | 'error'>('not-initialized');
  const [input, setInput] = useState('Hello, SDK!');
  const [output, setOutput] = useState('Output will appear here...');
  const [config, setConfig] = useState<SDKConfig | null>(null);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    const initSDK = async () => {
      try {
        await sdk.init();
        setStatus('initialized');
        setConfig(sdk.getConfig());
      } catch (error) {
        console.error('Failed to initialize SDK:', error);
        setStatus('error');
      }
    };

    initSDK();
  }, [sdk]);

  const handleProcess = async () => {
    if (!input) {
      setOutput('Please enter some text!');
      return;
    }

    try {
      setProcessing(true);
      const result = await sdk.doSomething(input);
      setOutput(result);
    } catch (error) {
      setOutput(`Error: ${error}`);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-600 to-purple-900 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-2xl w-full">
        <h1 className="text-4xl font-bold text-gray-800 mb-2">🚀 SDK Boilerplate</h1>
        <p className="text-gray-600 mb-6">Vite + React + TypeScript + Tailwind</p>

        <div className={`px-4 py-2 rounded-lg mb-6 inline-block ${
          status === 'initialized' ? 'bg-green-100 text-green-800' :
          status === 'error' ? 'bg-red-100 text-red-800' :
          'bg-gray-100 text-gray-800'
        }`}>
          Status: {status === 'initialized' ? 'Initialized' : status === 'error' ? 'Error' : 'Not Initialized'}
        </div>

        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-semibold text-gray-800 mb-4">SDK Demo</h2>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Enter some text..."
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none mb-3"
            />
            <button
              onClick={handleProcess}
              disabled={processing}
              className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-gray-400 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
            >
              {processing ? 'Processing...' : 'Process with SDK'}
            </button>
            <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
              <p className="text-gray-700 font-mono text-sm">{output}</p>
            </div>
          </div>

          <div>
            <h2 className="text-2xl font-semibold text-gray-800 mb-4">Configuration</h2>
            <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
              <pre className="text-gray-700 font-mono text-sm overflow-x-auto">
                {config ? JSON.stringify(config, null, 2) : 'Loading...'}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;

