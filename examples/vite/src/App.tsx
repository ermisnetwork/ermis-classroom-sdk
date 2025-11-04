import { useRef, useState } from "react";
import { ErmisClassroomProvider } from "./context";
import VideoMeeting from "./VideoMeeting";
import "./App.css";

function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [selectedNode, setSelectedNode] = useState("admin.bandia.vn:9995");
  const [publishProtocol, setPublishProtocol] = useState("webrtc");
  // const [publishProtocol, setPublishProtocol] = useState("webtransport");
  const [subscribeProtocol, setSubscribeProtocol] = useState("websocket");
  // const [subscribeProtocol, setSubscribeProtocol] = useState("webtransport");
  const [apiHost, setApiHost] = useState("daibo.ermis.network:9934");

  return (
    <ErmisClassroomProvider
      config={{
        host: apiHost,
        debug: true,
        webtpUrl: `https://${selectedNode}/meeting/wt`,
        publishProtocol: publishProtocol,
        subscribeProtocol: subscribeProtocol,
        hostNode: selectedNode,
        apiHost: apiHost,
      }}
      videoRef={videoRef}
    >
      <VideoMeeting
        videoRef={videoRef}
        selectedNode={selectedNode}
        setSelectedNode={setSelectedNode}
        publishProtocol={publishProtocol}
        setPublishProtocol={setPublishProtocol}
        subscribeProtocol={subscribeProtocol}
        setSubscribeProtocol={setSubscribeProtocol}
        apiHost={apiHost}
        setApiHost={setApiHost}
      />
    </ErmisClassroomProvider>
  );
}

export default App;
