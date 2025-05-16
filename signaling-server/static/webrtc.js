// Configuration
let peerConnection;
let localStream;
let remoteStream;
let socket;
let username;
let targetUser;
let isInitiator = false;

// UI elements
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const statusDiv = document.getElementById('status');
const connectBtn = document.getElementById('connect-btn');
const callBtn = document.getElementById('call-btn');
const endBtn = document.getElementById('end-btn');
const muteBtn = document.getElementById('mute-btn');
const videoBtn = document.getElementById('video-btn');

// WebRTC configuration - will be updated with TURN later
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' }
  ]
};

// Connect to signaling server
connectBtn.addEventListener('click', async () => {
  username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  targetUser = document.getElementById('targetUser').value;
  
  if (!username || !password || !targetUser) {
    alert('Please enter all fields');
    return;
  }
  
  // Connect to WebSocket with credentials
  socket = new WebSocket(`ws://localhost:8080/ws?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`);
  
  socket.onopen = async () => {
    updateStatus('Connected to signaling server');
    connectBtn.disabled = true;
    callBtn.disabled = false;
    
    // Get user media and show in local video
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localVideo.srcObject = localStream;
      muteBtn.disabled = false;
      videoBtn.disabled = false;
    } catch (err) {
      console.error('Error accessing media devices:', err);
      updateStatus('Error: ' + err.message);
    }
  };
  
  socket.onclose = () => {
    updateStatus('Disconnected from signaling server');
    resetUI();
  };
  
  socket.onerror = (error) => {
    console.error('WebSocket error:', error);
    updateStatus('Connection error');
    resetUI();
  };
  
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    handleSignalingMessage(message);
  };
});

// Start call
callBtn.addEventListener('click', () => {
  isInitiator = true;
  createPeerConnection();
  updateStatus('Starting call...');
  callBtn.disabled = true;
  endBtn.disabled = false;
});

// End call
endBtn.addEventListener('click', () => {
  endCall();
  updateStatus('Call ended');
  callBtn.disabled = false;
  endBtn.disabled = true;
});

// Toggle audio mute
muteBtn.addEventListener('click', () => {
  const audioTracks = localStream.getAudioTracks();
  const muted = audioTracks[0].enabled = !audioTracks[0].enabled;
  
  if (muted) {
    muteBtn.textContent = 'Mute Audio';
    muteBtn.classList.remove('muted');
  } else {
    muteBtn.textContent = 'Unmute Audio';
    muteBtn.classList.add('muted');
  }
});

// Toggle video
videoBtn.addEventListener('click', () => {
  const videoTracks = localStream.getVideoTracks();
  const videoOff = videoTracks[0].enabled = !videoTracks[0].enabled;
  
  if (videoOff) {
    videoBtn.textContent = 'Turn Off Video';
    videoBtn.classList.remove('video-off');
  } else {
    videoBtn.textContent = 'Turn On Video';
    videoBtn.classList.add('video-off');
  }
});

// Create RTCPeerConnection
function createPeerConnection() {
  peerConnection = new RTCPeerConnection(rtcConfig);
  
  // Add local stream tracks to connection
  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
  });
  
  // Set up remote stream
  remoteStream = new MediaStream();
  remoteVideo.srcObject = remoteStream;
  
  // Handle incoming tracks
  peerConnection.ontrack = (event) => {
    event.streams[0].getTracks().forEach(track => {
      remoteStream.addTrack(track);
    });
  };
  
  // Handle ICE candidates
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      sendSignalingMessage({
        type: 'candidate',
        payload: JSON.stringify(event.candidate),
        target: targetUser
      });
    }
  };
  
  // Connection state changes
  peerConnection.oniceconnectionstatechange = () => {
    updateStatus('ICE connection state: ' + peerConnection.iceConnectionState);
    
    if (peerConnection.iceConnectionState === 'connected' || 
        peerConnection.iceConnectionState === 'completed') {
      updateStatus('Call connected!');
    }
  };
  
  // If initiator, create offer
  if (isInitiator) {
    createOffer();
  }
}

// Create and send offer
async function createOffer() {
  try {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    
    sendSignalingMessage({
      type: 'offer',
      payload: JSON.stringify(offer),
      target: targetUser
    });
    
    updateStatus('Offer sent, waiting for answer...');
  } catch (error) {
    console.error('Error creating offer:', error);
    updateStatus('Error creating offer');
  }
}

// Handle incoming signaling messages
async function handleSignalingMessage(message) {
  console.log('Received message:', message);
  
  switch (message.type) {
    case 'offer':
      if (!peerConnection) {
        createPeerConnection();
      }
      
      try {
        const offerDescription = JSON.parse(message.payload);
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offerDescription));
        
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        
        sendSignalingMessage({
          type: 'answer',
          payload: JSON.stringify(answer),
          target: message.username
        });
        
        updateStatus('Received offer, sent answer');
        endBtn.disabled = false;
      } catch (error) {
        console.error('Error handling offer:', error);
        updateStatus('Error handling offer');
      }
      break;
      
    case 'answer':
      try {
        const answerDescription = JSON.parse(message.payload);
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answerDescription));
        updateStatus('Received answer, connection establishing...');
      } catch (error) {
        console.error('Error handling answer:', error);
        updateStatus('Error handling answer');
      }
      break;
      
    case 'candidate':
      try {
        const candidate = JSON.parse(message.payload);
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.error('Error adding ICE candidate:', error);
      }
      break;
      
    case 'join':
      updateStatus(`${message.username} joined`);
      break;
      
    case 'leave':
      if (message.username === targetUser) {
        updateStatus(`${message.username} left, call ended`);
        endCall();
      }
      break;
  }
}

// Send message via signaling server
function sendSignalingMessage(message) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    message.username = username;
    socket.send(JSON.stringify(message));
  }
}

// End current call
function endCall() {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  
  remoteVideo.srcObject = null;
  callBtn.disabled = false;
  endBtn.disabled = true;
  updateStatus('Call ended');
}

// Reset UI on disconnect
function resetUI() {
  connectBtn.disabled = false;
  callBtn.disabled = true;
  endBtn.disabled = true;
  muteBtn.disabled = true;
  videoBtn.disabled = true;
}

// Update status display
function updateStatus(message) {
  statusDiv.textContent = message;
  console.log(message);
}