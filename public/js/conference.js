/********************************************
 * conference.js
 ********************************************/

// ==================== Socket.io ====================
const socket = io();

// ==================== Récupération des paramètres URL (username, room) ====================
const urlParams = new URLSearchParams(window.location.search);
const localUserName = urlParams.get('username') || 'Moi';
const roomId = urlParams.get('room') || 'maSalle';

// ==================== Sélecteurs HTML ====================
const toggleCameraBtn = document.getElementById('toggleCamera');
const toggleMicrophoneBtn = document.getElementById('toggleMicrophone');
const shareScreenBtn = document.getElementById('shareScreen');
const settingsBtn = document.getElementById('settings');
const quitRoomBtn = document.getElementById('quitRoom');

const localVideoElem = document.getElementById('localVideo');
const cameraOffOverlay = document.getElementById('cameraOffOverlay');
const muteOverlay = document.getElementById('muteOverlay');
const localPlaceholder = document.getElementById('localPlaceholder');

// Conteneurs des flux distants
const remoteVideosContainer = document.getElementById('remoteVideos');
const remoteScreensContainer = document.getElementById('remoteScreens');

// Modal périphériques
const deviceModal = document.getElementById('deviceModal');
const closeModalBtn = document.getElementById('closeModal');
const saveDevicesBtn = document.getElementById('saveDevices');
const videoSelect = document.getElementById('videoSelect');
const audioSelect = document.getElementById('audioSelect');
const speakerSelect = document.getElementById('speakerSelect');

// Chat
const messagesDiv = document.getElementById('messages');
const chatInput = document.getElementById('chatInput');
const chatSendBtn = document.getElementById('chatSend');

// ==================== Variables globales ====================
let localStream = null;
let peerConnections = {}; // peerId -> RTCPeerConnection
let screenSharing = false;

// Configuration STUN/TURN
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' }
    // On peut ajouter un serveur TURN ici si besoin
  ]
};

// ==================== Initialisation du flux local ====================
async function initLocalMedia() {
  try {
    // Demande la caméra et le micro
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });

    // Désactiver la caméra par défaut
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = false; // caméra désactivée
      cameraOffOverlay.classList.remove('hidden'); 
      toggleCameraBtn.classList.add('bg-red-500');
    }

    // (Optionnel) Désactiver le micro par défaut
    // const audioTrack = localStream.getAudioTracks()[0];
    // if (audioTrack) {
    //   audioTrack.enabled = false;
    //   muteOverlay.classList.remove('hidden');
    //   toggleMicrophoneBtn.classList.add('bg-red-500');
    // }

    localVideoElem.srcObject = localStream;
    localVideoElem.muted = true; // pas de retour audio local
    localVideoElem.classList.remove('hidden');
    localPlaceholder.classList.add('hidden');

    console.log("Flux local OK (caméra & micro), caméra off par défaut.");
  } catch (err) {
    console.error("Erreur accès caméra/micro :", err);
    alert("Impossible d'accéder à la caméra ou au micro.");
  }
}

// Démarrer l'init puis rejoindre la room
initLocalMedia().then(() => {
  socket.emit('join-room', roomId, localUserName);
});

// ==================== Gestion des connexions WebRTC ====================
socket.on('room-users', (userIds) => {
  // Pour chaque utilisateur déjà présent, on établit une connexion
  userIds.forEach(peerId => {
    if (!peerConnections[peerId]) {
      const pc = createPeerConnection(peerId);
      peerConnections[peerId] = pc;

      // Ajouter nos pistes locales
      if (localStream) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
      }

      // Créer et envoyer l'offre
      pc.createOffer().then(offer => {
        pc.setLocalDescription(offer);
        socket.emit('video-offer', offer, peerId);
      }).catch(err => console.error("Erreur création offre:", err));
    }
  });
});

function createPeerConnection(peerId) {
  const pc = new RTCPeerConnection(rtcConfig);

  pc.onicecandidate = event => {
    if (event.candidate) {
      socket.emit('new-ice-candidate', event.candidate, peerId);
    }
  };

  // Quand on reçoit des pistes (audio/vidéo) du pair
  pc.ontrack = event => {
    const track = event.track;
    const stream = event.streams[0];
    if (!stream) return;

    // On détecte si c'est un partage d'écran (via track.label) ou une caméra
    if (track.kind === 'video') {
      const label = track.label.toLowerCase();
      const isScreen = label.includes('screen') || label.includes('window');

      // On construit un ID unique pour l'élément
      const videoElemId = isScreen ? `screen-${peerId}` : `video-${peerId}`;

      // Vérifier qu'on ne l'a pas déjà (éviter double affichage)
      if (document.getElementById(videoElemId)) {
        return;
      }

      // Création du conteneur
      const wrapper = document.createElement('div');
      wrapper.classList.add('video-card', 'relative', 'p-2', 'bg-gray-900', 'rounded');

      // Création de la vidéo
      const remoteVideo = document.createElement('video');
      remoteVideo.srcObject = stream;
      remoteVideo.autoplay = true;
      remoteVideo.playsInline = true;
      remoteVideo.id = videoElemId;
      remoteVideo.classList.add('w-full', 'h-full', 'object-cover', 'rounded');

      // Wrapper volume & mute local
      const volumeWrapper = document.createElement('div');
      volumeWrapper.classList.add('flex', 'items-center', 'mt-2', 'gap-2');

      const volumeLabel = document.createElement('span');
      volumeLabel.textContent = 'Volume:';

      const volumeSlider = document.createElement('input');
      volumeSlider.type = 'range';
      volumeSlider.min = '0';
      volumeSlider.max = '1';
      volumeSlider.step = '0.01';
      volumeSlider.value = '1';
      volumeSlider.classList.add('flex-1');
      volumeSlider.addEventListener('input', () => {
        remoteVideo.volume = volumeSlider.value;
      });

      const muteBtn = document.createElement('button');
      muteBtn.textContent = 'Mute';
      muteBtn.classList.add('bg-gray-600', 'px-2', 'rounded');
      let localMuted = false;
      muteBtn.addEventListener('click', () => {
        localMuted = !localMuted;
        remoteVideo.muted = localMuted;
        muteBtn.textContent = localMuted ? 'Unmute' : 'Mute';
      });

      volumeWrapper.appendChild(volumeLabel);
      volumeWrapper.appendChild(volumeSlider);
      volumeWrapper.appendChild(muteBtn);

      // Ajout de la vidéo au wrapper
      wrapper.appendChild(remoteVideo);

      // Bouton plein écran si c'est un partage d'écran
      if (isScreen) {
        const fullscreenBtn = document.createElement('button');
        fullscreenBtn.innerHTML = '<i class="fa-solid fa-expand fa-lg"></i>';
        fullscreenBtn.classList.add(
          'absolute', 'top-1', 'right-1',
          'bg-gray-800', 'rounded-full', 'p-2', 'cursor-pointer', 'z-10'
        );
        fullscreenBtn.title = 'Plein écran';
        fullscreenBtn.addEventListener('click', () => {
          if (!document.fullscreenElement) {
            // Demander le fullscreen
            wrapper.requestFullscreen && wrapper.requestFullscreen();
          } else {
            // Quitter le fullscreen
            document.exitFullscreen && document.exitFullscreen();
          }
        });
        wrapper.appendChild(fullscreenBtn);
      }

      // Ajouter le slider de volume/mute en dessous
      wrapper.appendChild(volumeWrapper);

      // On place le conteneur dans la bonne zone
      if (isScreen) {
        remoteScreensContainer.appendChild(wrapper);
      } else {
        remoteVideosContainer.appendChild(wrapper);
      }
    } 
    else if (track.kind === 'audio') {
      // L’audio est déjà géré par le même srcObject s’il y a une vidéo; rien d’obligatoire
    }
  };

  return pc;
}

// Un nouvel utilisateur arrive
socket.on('user-joined', (peerId, userName) => {
  console.log(`${userName} a rejoint (ID: ${peerId}). Préparation connexion...`);
  if (!peerConnections[peerId]) {
    const pc = createPeerConnection(peerId);
    peerConnections[peerId] = pc;
    if (localStream) {
      localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }
  }
});

// On reçoit une offre
socket.on('video-offer', async (offer, fromId, fromName) => {
  console.log("Offre WebRTC reçue de", fromId, fromName);
  let pc = peerConnections[fromId];
  if (!pc) {
    pc = createPeerConnection(fromId);
    peerConnections[fromId] = pc;
    if (localStream) {
      localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }
  }
  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit('video-answer', pc.localDescription, fromId);
});

// On reçoit la réponse
socket.on('video-answer', async (answer, fromId) => {
  const pc = peerConnections[fromId];
  if (pc) {
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
  }
});

// Nouveau candidat ICE
socket.on('new-ice-candidate', async (candidate, fromId) => {
  const pc = peerConnections[fromId];
  if (pc) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.error("Erreur ajout candidate ICE:", err);
    }
  }
});

// Un utilisateur quitte
socket.on('user-left', (peerId, name) => {
  console.log(`${name} (${peerId}) a quitté.`);
  if (peerConnections[peerId]) {
    peerConnections[peerId].close();
    delete peerConnections[peerId];
  }
  // Supprimer les éléments vidéo/screen correspondants
  const vid = document.getElementById(`video-${peerId}`);
  if (vid && vid.parentNode) {
    vid.parentNode.remove();
  }
  const scr = document.getElementById(`screen-${peerId}`);
  if (scr && scr.parentNode) {
    scr.parentNode.remove();
  }
});

// ==================== Actions locales ====================
// Toggle caméra
toggleCameraBtn.addEventListener('click', () => {
  if (!localStream) return;
  const videoTrack = localStream.getVideoTracks()[0];
  if (!videoTrack) return;

  videoTrack.enabled = !videoTrack.enabled;

  if (videoTrack.enabled) {
    // Caméra ON
    cameraOffOverlay.classList.add('hidden');
    toggleCameraBtn.classList.remove('bg-red-500');
    toggleCameraBtn.classList.add('bg-gray-700');
    document.getElementById('cameraOn').classList.remove('hidden');
    document.getElementById('cameraOff').classList.add('hidden');
  } else {
    // Caméra OFF
    cameraOffOverlay.classList.remove('hidden');
    toggleCameraBtn.classList.add('bg-red-500');
    toggleCameraBtn.classList.remove('bg-gray-700');
    document.getElementById('cameraOn').classList.add('hidden');
    document.getElementById('cameraOff').classList.remove('hidden');
  }

  const newState = videoTrack.enabled ? 'on' : 'off';
  socket.emit('toggle-media', 'video', newState);
});

// Toggle micro
toggleMicrophoneBtn.addEventListener('click', () => {
  if (!localStream) return;
  const audioTrack = localStream.getAudioTracks()[0];
  if (!audioTrack) return;

  audioTrack.enabled = !audioTrack.enabled;

  if (audioTrack.enabled) {
    // Micro ON
    muteOverlay.classList.add('hidden');
    toggleMicrophoneBtn.classList.remove('bg-red-500');
    toggleMicrophoneBtn.classList.add('bg-gray-700');
    document.getElementById('microphoneOn').classList.remove('hidden');
    document.getElementById('microphoneOff').classList.add('hidden');
  } else {
    // Micro OFF
    muteOverlay.classList.remove('hidden');
    toggleMicrophoneBtn.classList.add('bg-red-500');
    toggleMicrophoneBtn.classList.remove('bg-gray-700');
    document.getElementById('microphoneOn').classList.add('hidden');
    document.getElementById('microphoneOff').classList.remove('hidden');
  }

  const newState = audioTrack.enabled ? 'on' : 'off';
  socket.emit('toggle-media', 'audio', newState);
});

// Partage d’écran local
shareScreenBtn.addEventListener('click', async () => {
  if (!localStream) return;
  try {
    if (!screenSharing) {
      // Commencer le partage
      const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      const screenTrack = screenStream.getVideoTracks()[0];
      
      // Affichage local
      const localScreenElem = document.getElementById('localScreen');
      localScreenElem.srcObject = screenStream;
      localScreenElem.classList.remove('hidden');
      document.getElementById('screenPlaceholder').classList.add('hidden');
      document.getElementById('localScreenWrapper').style.display = 'block';
      screenSharing = true;

      // Remplacer la piste vidéo pour chaque RTCPeerConnection
      for (let peerId in peerConnections) {
        const pc = peerConnections[peerId];
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) {
          await sender.replaceTrack(screenTrack);
        }
      }

      // Quand l’utilisateur arrête le partage
      screenTrack.onended = async () => {
        stopScreenShare();
      };
    } else {
      // Arrêter le partage
      stopScreenShare();
    }
  } catch (err) {
    console.error("Échec partage d'écran:", err);
  }
});

async function stopScreenShare() {
  if (!localStream) return;
  // Remet la caméra
  const cameraTrack = localStream.getVideoTracks()[0];
  if (cameraTrack) cameraTrack.enabled = true;

  // Réaffecter la piste caméra dans toutes les PC
  for (let peerId in peerConnections) {
    const pc = peerConnections[peerId];
    const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
    if (sender && cameraTrack) {
      await sender.replaceTrack(cameraTrack);
    }
  }

  // Cacher l’aperçu local du screen
  const localScreenElem = document.getElementById('localScreen');
  if (localScreenElem.srcObject) {
    localScreenElem.srcObject.getTracks().forEach(t => t.stop());
  }
  localScreenElem.srcObject = null;
  localScreenElem.classList.add('hidden');
  document.getElementById('screenPlaceholder').classList.remove('hidden');
  document.getElementById('localScreenWrapper').style.display = 'none';
  screenSharing = false;
}

// Quitter la room
quitRoomBtn.addEventListener('click', () => {
  // Notifier le serveur
  socket.emit('leave-room', roomId);

  // Fermer toutes les connexions
  for (let pid in peerConnections) {
    peerConnections[pid].close();
  }
  peerConnections = {};

  // Couper nos pistes locales
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
  }

  // Rediriger vers l’index
  window.location.href = '/';
});

// ==================== Modal Paramètres ====================
settingsBtn.addEventListener('click', () => {
  deviceModal.style.display = 'flex'; 

  // Lister les périphériques
  navigator.mediaDevices.enumerateDevices().then(devices => {
    // Vider les listes
    videoSelect.innerHTML = '';
    audioSelect.innerHTML = '';
    speakerSelect.innerHTML = '';

    devices.forEach(device => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.text = device.label || `${device.kind} (${device.deviceId})`;

      if (device.kind === 'videoinput') {
        videoSelect.appendChild(option);
      } else if (device.kind === 'audioinput') {
        audioSelect.appendChild(option);
      } else if (device.kind === 'audiooutput') {
        speakerSelect.appendChild(option);
      }
    });
  });
});

// Fermer la modale
closeModalBtn.addEventListener('click', () => {
  deviceModal.style.display = 'none';
});

// Sauver les paramètres
saveDevicesBtn.addEventListener('click', async () => {
  deviceModal.style.display = 'none';

  // Nouveaux constraints
  const newConstraints = {
    video: { deviceId: { exact: videoSelect.value } },
    audio: { deviceId: { exact: audioSelect.value } }
  };

  try {
    // Stop l’ancien flux
    if (localStream) {
      localStream.getTracks().forEach(t => t.stop());
    }
    localStream = await navigator.mediaDevices.getUserMedia(newConstraints);

    // Caméra off par défaut
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = false;
      cameraOffOverlay.classList.remove('hidden');
      toggleCameraBtn.classList.add('bg-red-500');
      toggleCameraBtn.classList.remove('bg-gray-700');
      document.getElementById('cameraOn').classList.add('hidden');
      document.getElementById('cameraOff').classList.remove('hidden');
    }

    localVideoElem.srcObject = localStream;
    localVideoElem.classList.remove('hidden');
    localPlaceholder.classList.add('hidden');

    // Ré-injecter la nouvelle piste dans les RTCPeerConnection
    for (let pid in peerConnections) {
      const pc = peerConnections[pid];
      // Vidéo
      const senders = pc.getSenders().filter(s => s.track && s.track.kind === 'video');
      if (senders.length > 0 && videoTrack) {
        await senders[0].replaceTrack(videoTrack);
      }
      // Audio
      const audioTrack = localStream.getAudioTracks()[0];
      const audioSenders = pc.getSenders().filter(s => s.track && s.track.kind === 'audio');
      if (audioSenders.length > 0 && audioTrack) {
        await audioSenders[0].replaceTrack(audioTrack);
      }
    }

    console.log("Périphériques reconfigurés !");
  } catch (err) {
    console.error("Erreur reconfiguration :", err);
  }
});

// ==================== Chat temps réel ====================
chatSendBtn.addEventListener('click', sendChatMessage);
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    sendChatMessage();
  }
});

// Envoi d’un message
function sendChatMessage() {
  const message = chatInput.value.trim();
  if (!message) return;
  socket.emit('chat-message', message, localUserName);
  chatInput.value = '';
}

// Réception d’un message
socket.on('chat-message', (message, userName, time) => {
  const msgLine = document.createElement('div');
  msgLine.classList.add('mb-2');
  msgLine.innerHTML = `<strong>${userName}</strong> <span class="text-xs text-gray-400">(${time})</span><br>${message}`;
  messagesDiv.appendChild(msgLine);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
});

// ==================== Tooltips ====================
document.addEventListener('DOMContentLoaded', () => {
  if (typeof tippy === 'function') {
    tippy('[data-tippy-content]');
  }
});
