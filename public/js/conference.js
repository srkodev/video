/********************************************
 * conference.js
 ********************************************/

// ==================== Socket.io ====================
const socket = io();

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

const remoteVideosContainer = document.getElementById('remoteVideos');

// Modal périphériques
const deviceModal = document.getElementById('deviceModal');
const closeModalBtn = document.getElementById('closeModal');
const saveDevicesBtn = document.getElementById('saveDevices');
const videoSelect = document.getElementById('videoSelect');
const audioSelect = document.getElementById('audioSelect');
const speakerSelect = document.getElementById('speakerSelect');

// ==================== Variables globales ====================
let localStream = null;
let peerConnections = {}; // peerId -> RTCPeerConnection
let localUserName = prompt("Entrez votre nom :") || "Moi";
let roomId = prompt("ID de la réunion à rejoindre :") || "maSalle"; // identifiant de la salle

// Configuration de base STUN/TURN
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' }
    // On peut ajouter un serveur TURN ici pour plus de fiabilité
  ]
};

// ==================== Initialisation du flux local ====================
async function initLocalMedia() {
  try {
    // Caméra et micro activés dans la contrainte, mais on va désactiver la caméra juste après
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });

    // Rendre la caméra OFF par défaut : on coupe la piste vidéo
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = false; // caméra désactivée par défaut
      cameraOffOverlay.classList.remove('hidden'); // on affiche l’overlay "Caméra off"
      toggleCameraBtn.classList.add('bg-red-500');
    }

    // Idem pour l’audio si tu veux le mute par défaut :
    // const audioTrack = localStream.getAudioTracks()[0];
    // if (audioTrack) {
    //   audioTrack.enabled = false;
    //   muteOverlay.classList.remove('hidden');
    //   toggleMicrophoneBtn.classList.add('bg-red-500');
    // }

    localVideoElem.srcObject = localStream;
    localVideoElem.muted = true; // Pour éviter l'écho en local
    localVideoElem.classList.remove('hidden'); // on montre la balise <video>
    localPlaceholder.classList.add('hidden');  // on masque le placeholder
    console.log("Flux local capturé (caméra et micro), caméra éteinte par défaut.");
  } catch (err) {
    console.error("Erreur d'accès à la caméra/micro :", err);
    alert("Impossible d'accéder à la caméra ou au micro.");
  }
}

// Appeler l'initialisation puis rejoindre la salle
initLocalMedia().then(() => {
  socket.emit('join-room', roomId, localUserName);
});

// ==================== Socket.io: Événements liaison WebRTC ====================

// À l'arrivée dans la salle, le serveur nous renvoie la liste des utilisateurs
socket.on('room-users', (userIds /*..., ...*/) => {
  // Pour chaque utilisateur déjà présent, on établit une connexion
  userIds.forEach(peerId => {
    const pc = createPeerConnection(peerId);
    peerConnections[peerId] = pc;
    // Ajouter nos pistes locales
    if (localStream) {
      localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }
    // Créer et envoyer l'offre
    pc.createOffer()
      .then(offer => pc.setLocalDescription(offer))
      .then(() => {
        socket.emit('video-offer', pc.localDescription, peerId);
      })
      .catch(err => console.error("Erreur création offre WebRTC:", err));
  });
});

// Création d'une RTCPeerConnection + configuration des événements
function createPeerConnection(peerId) {
  const pc = new RTCPeerConnection(rtcConfig);

  pc.onicecandidate = event => {
    if (event.candidate) {
      socket.emit('new-ice-candidate', event.candidate, peerId);
    }
  };

  // Quand on reçoit des pistes du pair
  pc.ontrack = event => {
    // Ajouter la vidéo distante
    const remoteVideo = document.createElement('video');
    remoteVideo.srcObject = event.streams[0];
    remoteVideo.autoplay = true;
    remoteVideo.playsInline = true;
    remoteVideo.id = `video-${peerId}`;
    remoteVideo.classList.add('w-full', 'h-full', 'object-cover');
    // Ajouter dans le conteneur
    const wrapper = document.createElement('div');
    wrapper.classList.add('video-card', 'relative');
    wrapper.appendChild(remoteVideo);
    remoteVideosContainer.appendChild(wrapper);

    console.log("Flux vidéo reçu d'un pair:", peerId);
  };

  return pc;
}

// Un nouvel utilisateur rejoint
socket.on('user-joined', (peerId, name /*..., ...*/) => {
  console.log(`${name} a rejoint. Préparation de la connexion...`);
  const pc = createPeerConnection(peerId);
  peerConnections[peerId] = pc;
  if (localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }
});

// On reçoit une offre WebRTC d'un pair
socket.on('video-offer', async (offer, fromId /*..., ...*/) => {
  console.log("Offre WebRTC reçue de", fromId);
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

// On reçoit une "answer" WebRTC d'un pair
socket.on('video-answer', async (answer, fromId) => {
  console.log("Réponse WebRTC reçue de", fromId);
  const pc = peerConnections[fromId];
  if (pc) {
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
  }
});

// Nouveau candidat ICE reçu
socket.on('new-ice-candidate', async (candidate, fromId) => {
  const pc = peerConnections[fromId];
  if (pc) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
      console.log("Candidat ICE ajouté pour", fromId);
    } catch (err) {
      console.error("Erreur ajout du candidat ICE:", err);
    }
  }
});

// Quand un utilisateur quitte
socket.on('user-left', (peerId, name) => {
  console.log(`${name} a quitté la réunion.`);
  if (peerConnections[peerId]) {
    peerConnections[peerId].close();
    delete peerConnections[peerId];
  }
  const vidElem = document.getElementById(`video-${peerId}`);
  if (vidElem && vidElem.parentNode) {
    vidElem.parentNode.remove();
  }
});

// ==================== Gestion des boutons locaux ====================

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
    // Icônes dans le HTML (faire apparaître la caméra On, masquer la Off)
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

  // Informer les pairs si besoin
  const newState = videoTrack.enabled ? 'on' : 'off';
  socket.emit('toggle-media', 'video', newState);
});

// Toggle microphone
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

// Partage d'écran
shareScreenBtn.addEventListener('click', async () => {
  if (!localStream) return;
  try {
    const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const screenTrack = screenStream.getVideoTracks()[0];

    // Remplacer la piste vidéo par la piste écran
    for (let peerId in peerConnections) {
      const pc = peerConnections[peerId];
      const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) {
        sender.replaceTrack(screenTrack);
      }
    }
    // Afficher l’écran partagé dans la vidéo locale
    localVideoElem.srcObject = screenStream;

    // Quand l’utilisateur arrête le partage
    screenTrack.onended = () => {
      // Restaurer la caméra
      const cameraTrack = localStream.getVideoTracks()[0];
      if (cameraTrack) cameraTrack.enabled = true;

      for (let peerId in peerConnections) {
        const pc = peerConnections[peerId];
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender && cameraTrack) {
          sender.replaceTrack(cameraTrack);
        }
      }
      localVideoElem.srcObject = localStream;
    };
  } catch (err) {
    console.error("Échec du partage d'écran:", err);
  }
});

// Quitter la room
quitRoomBtn.addEventListener('click', () => {
  // Notifier le serveur
  socket.emit('leave-room', roomId);

  // Fermer toutes les connexions p2p
  for (let pid in peerConnections) {
    peerConnections[pid].close();
  }
  peerConnections = {};

  // Couper nos propres tracks
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
  }

  // Redirection éventuelle, ou simple rechargement :
  // window.location.href = '/';  // A adapter
});

// ==================== Modal Paramètres (Caméra, Micro, etc.) ====================
settingsBtn.addEventListener('click', () => {
  deviceModal.style.display = 'flex'; // on affiche la modale

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

// Sauver les nouveaux choix (simple exemple)
saveDevicesBtn.addEventListener('click', async () => {
  deviceModal.style.display = 'none';

  // Exemple : ré-initialiser le flux local avec les nouveaux deviceId
  // NB : ceci est un exemple, à adapter
  const newConstraints = {
    video: { deviceId: { exact: videoSelect.value } },
    audio: { deviceId: { exact: audioSelect.value } }
  };

  try {
    // Stopper l’ancien flux
    if (localStream) {
      localStream.getTracks().forEach(t => t.stop());
    }
    localStream = await navigator.mediaDevices.getUserMedia(newConstraints);

    // Par défaut, on éteint toujours la caméra si c’est ta logique
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = false;
      cameraOffOverlay.classList.remove('hidden');
      toggleCameraBtn.classList.add('bg-red-500');
      toggleCameraBtn.classList.remove('bg-gray-700');
      document.getElementById('cameraOn').classList.add('hidden');
      document.getElementById('cameraOff').classList.remove('hidden');
    }

    // Mettre à jour l’élément vidéo local
    localVideoElem.srcObject = localStream;
    localPlaceholder.classList.add('hidden');
    localVideoElem.classList.remove('hidden');

    // Ré-injecter la nouvelle piste dans les RTCPeerConnection existantes
    for (let pid in peerConnections) {
      const pc = peerConnections[pid];
      const senders = pc.getSenders().filter(s => s.track && s.track.kind === 'video');
      if (senders.length > 0 && videoTrack) {
        senders[0].replaceTrack(videoTrack);
      }
      // Idem pour l’audio
      const audioTrack = localStream.getAudioTracks()[0];
      const audioSenders = pc.getSenders().filter(s => s.track && s.track.kind === 'audio');
      if (audioSenders.length > 0 && audioTrack) {
        audioSenders[0].replaceTrack(audioTrack);
      }
    }

    console.log("Périphériques reconfigurés !");
  } catch (err) {
    console.error("Erreur reconfiguration périphériques :", err);
  }
});

// ==================== Initialisation des tooltips ====================
document.addEventListener('DOMContentLoaded', () => {
  if (typeof tippy === 'function') {
    tippy('[data-tippy-content]');
  }
});
