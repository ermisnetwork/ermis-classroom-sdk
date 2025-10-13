import { useRef } from "react";
import { ErmisClassroomProvider } from "./context";
import VideoMeeting from "./VideoMeeting";
import "./App.css";

function App() {
  const videoRef = useRef<HTMLVideoElement>(null);

  return (
    <ErmisClassroomProvider
      config={{
        host: "daibo.ermis.network:9994",
        debug: true,
        webtpUrl: "https://daibo.ermis.network:9994/meeting/wt",
      }}
      videoRef={videoRef}
    >
      <VideoMeeting videoRef={videoRef} />
    </ErmisClassroomProvider>
  );
}

export default App;
