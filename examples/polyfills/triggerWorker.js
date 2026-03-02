console.log("worker.js loaded, interval for wake processor");

self.onmessage = (e) => {
  const frameRate = e.data.frameRate || 33;
  const interval = 1000 / frameRate;

  function sendFrame() {
    self.postMessage(performance.now());
    setTimeout(sendFrame, interval);
  }

  sendFrame();
};
