self.onmessage = (e) => {
  const interval = e.data.interval || 500;

  function sendFrame() {
    self.postMessage(performance.now());
    setTimeout(sendFrame, interval);
  }

  sendFrame();
};
