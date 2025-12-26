- add subscribe over rtc datachannel, change offer request payload:
from: 
 console.log(`[WebRTC] Sending offer to server for: ${channelName}`);
        const response = await fetch(
          `https://${this.serverUrl}/meeting/sdp/answer`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              offer,
              room_id: this.roomId,
              stream_id: this.streamId,
              action: channelName,
            }),
          }
        );

to:

log(`[WebRTC] Sending offer to server for: ${channelName}`);
        const bodyData = {
          offer,
          room_id: this.roomId,
          stream_id: this.streamId,
          action: "publisher_offer",
          channel: channelName,
        };
        console.log("Offer body data:", bodyData);
        const response = await fetch(
          `https://${this.serverUrl}/meeting/sdp/answer`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(bodyData),
          }
        );

      