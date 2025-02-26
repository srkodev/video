document.addEventListener('DOMContentLoaded', function () {
  // Variables globales
  let localStream = null; // Aucun flux par défaut
  let isCameraOn = false; // Caméra désactivée par défaut
  let isMicOn = true;     // Micro activé par défaut
  let isScreenSharing = false;
  let audioContext, analyser, dataArray, microphoneTimer;

  // Initialisation des tooltips
  tippy('[data-tippy-content]', { placement: 'top', animation: 'scale' });

  // Connexion au serveur de signalisation (Socket.io)
  const socket = io('http://localhost:3000');

  // Récupérer les paramètres de l'URL : nom d'utilisateur et room
  const urlParams = new URLSearchParams(window.location.search);
  const username = urlParams.get('username');
  const roomId = urlParams.get('room');

  // Rejoindre la room via Socket.io
  socket.emit('join-room', roomId, username);

  // Écouter les événements de connexion/déconnexion des autres utilisateurs
  socket.on('user-connected', data => {
    console.log("Utilisateur connecté :", data.username, data.userId);
    // Vous pouvez ici ajouter à votre interface la liste des participants
  });

  socket.on('user-disconnected', userId => {
    console.log("Utilisateur déconnecté :", userId);
    // Mettez à jour l'interface pour retirer cet utilisateur
  });

  // Bouton "Quit Room" : déconnecte le socket et redirige vers index.html
  document.getElementById('quitRoom').addEventListener('click', function () {
    socket.disconnect();
    window.location.href = "index.html";
  });

  // Au chargement, demander uniquement le flux audio pour la détection vocale
  async function initAudioStream() {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
      initAudioActivity(localStream);
    } catch (err) {
      console.error("Erreur lors de l'accès au micro :", err);
    }
  }
  initAudioStream();

  // Fonction pour demander et ajouter la vidéo au flux existant (audio déjà acquis)
  async function requestLocalStream(constraints = { video: true, audio: false }) {
    try {
      const newStream = await navigator.mediaDevices.getUserMedia(constraints);
      if (localStream && localStream.getAudioTracks().length > 0 && constraints.video) {
        newStream.getVideoTracks().forEach(track => localStream.addTrack(track));
      } else {
        localStream = newStream;
      }
      if (localStream.getVideoTracks().length > 0) {
        document.getElementById('localPlaceholder').classList.add('hidden');
        document.getElementById('localVideo').classList.remove('hidden');
        document.getElementById('localVideo').srcObject = localStream;
        document.getElementById('cameraOffOverlay').classList.add('hidden');
        isCameraOn = true;
        initAudioActivity(localStream);
        // Met à jour l'icône et la couleur du bouton caméra (vert quand activée)
        document.getElementById('cameraOn').classList.remove('hidden');
        document.getElementById('cameraOff').classList.add('hidden');
        document.getElementById('toggleCamera').classList.replace('bg-red-500', 'bg-green-500');
      }
    } catch (err) {
      console.error("Erreur lors de l'activation de la caméra :", err);
      alert("Permission refusée pour la caméra.");
    }
  }

  // Gestion du bouton caméra
  document.getElementById('toggleCamera').addEventListener('click', async function () {
    if (!isCameraOn) {
      await requestLocalStream({ video: true, audio: false });
    } else {
      if (localStream) {
        localStream.getVideoTracks().forEach(track => track.enabled = false);
      }
      isCameraOn = false;
      document.getElementById('cameraOn').classList.add('hidden');
      document.getElementById('cameraOff').classList.remove('hidden');
      document.getElementById('cameraOffOverlay').classList.remove('hidden');
      document.getElementById('toggleCamera').classList.replace('bg-green-500', 'bg-red-500');
    }
  });

  // Mise à jour de l'overlay "Muted" (overlay réduit)
  function updateMicVisual() {
    document.getElementById('muteOverlay').classList.toggle('hidden', isMicOn);
  }

  // Gestion du micro
  document.getElementById('toggleMicrophone').addEventListener('click', function () {
    if (localStream) {
      isMicOn = !isMicOn;
      localStream.getAudioTracks().forEach(track => track.enabled = isMicOn);
      document.getElementById('microphoneOn').classList.toggle('hidden', !isMicOn);
      document.getElementById('microphoneOff').classList.toggle('hidden', isMicOn);
      updateMicVisual();
      if (!isMicOn) {
        document.getElementById('toggleMicrophone').classList.replace('bg-gray-700', 'bg-red-500');
      } else {
        document.getElementById('toggleMicrophone').classList.replace('bg-red-500', 'bg-gray-700');
      }
    } else {
      alert("Le flux audio n'est pas encore disponible.");
    }
  });

  // Partage d'écran : afficher le flux d'écran dans le conteneur dédié
  document.getElementById('shareScreen').addEventListener('click', async function () {
    try {
      if (!isScreenSharing) {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        if (screenStream) {
          document.getElementById('localScreen').srcObject = screenStream;
          document.getElementById('localScreen').classList.remove('hidden');
          document.getElementById('screenPlaceholder').classList.add('hidden');
          document.getElementById('localScreenWrapper').style.display = "block";
          isScreenSharing = true;
          screenStream.getVideoTracks()[0].onended = function () {
            document.getElementById('localScreenWrapper').style.display = "none";
            document.getElementById('localScreen').classList.add('hidden');
            document.getElementById('screenPlaceholder').classList.remove('hidden');
            isScreenSharing = false;
          };
        }
      } else {
        document.getElementById('localScreenWrapper').style.display = "none";
        document.getElementById('localScreen').classList.add('hidden');
        document.getElementById('screenPlaceholder').classList.remove('hidden');
        isScreenSharing = false;
      }
    } catch (err) {
      console.error("Erreur lors du partage d'écran :", err);
      alert("Erreur lors du partage d'écran ou partage refusé.");
    }
  });

  // Plein écran pour le partage d'écran (sur le conteneur localScreenWrapper)
  document.getElementById('fullscreenScreenBtn').addEventListener('click', function () {
    const elem = document.getElementById('localScreenWrapper');
    if (elem.requestFullscreen) {
      elem.requestFullscreen();
    } else if (elem.webkitRequestFullscreen) {
      elem.webkitRequestFullscreen();
    } else if (elem.msRequestFullscreen) {
      elem.msRequestFullscreen();
    }
  });

  // Détecteur d'activité audio pour illuminer la bordure du conteneur de la caméra
  function initAudioActivity(stream) {
    if (microphoneTimer) clearInterval(microphoneTimer);
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    const bufferLength = analyser.frequencyBinCount;
    dataArray = new Uint8Array(bufferLength);
    source.connect(analyser);
    microphoneTimer = setInterval(() => {
      analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      dataArray.forEach(val => sum += val);
      const average = sum / bufferLength;
      if (average > 30) {
        document.getElementById('localStreamWrapper').classList.add('ring', 'ring-green-500');
      } else {
        document.getElementById('localStreamWrapper').classList.remove('ring', 'ring-green-500');
      }
    }, 200);
  }

  // Gestion de la modal pour la configuration des périphériques
  const deviceModal = document.getElementById('deviceModal');
  const videoSelect = document.getElementById('videoSelect');
  const audioSelect = document.getElementById('audioSelect');
  const speakerSelect = document.getElementById('speakerSelect');

  async function enumerateDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      videoSelect.innerHTML = "";
      audioSelect.innerHTML = "";
      speakerSelect.innerHTML = "";
      devices.forEach(device => {
        const option = document.createElement('option');
        option.value = device.deviceId;
        option.text = device.label || `${device.kind} ${device.deviceId}`;
        if (device.kind === 'videoinput') {
          videoSelect.appendChild(option);
        } else if (device.kind === 'audioinput') {
          audioSelect.appendChild(option);
        } else if (device.kind === 'audiooutput') {
          speakerSelect.appendChild(option);
        }
      });
    } catch (err) {
      console.error("Erreur lors de l'énumération des périphériques :", err);
    }
  }

  document.getElementById('settings').addEventListener('click', function () {
    enumerateDevices();
    deviceModal.style.display = "flex";
  });
  document.getElementById('closeModal').addEventListener('click', function () {
    deviceModal.style.display = "none";
  });
  document.getElementById('saveDevices').addEventListener('click', async function () {
    const selectedVideo = videoSelect.value;
    const selectedAudio = audioSelect.value;
    const constraints = {
      video: { deviceId: selectedVideo ? { exact: selectedVideo } : undefined },
      audio: { deviceId: selectedAudio ? { exact: selectedAudio } : undefined }
    };
    await requestLocalStream(constraints);
    deviceModal.style.display = "none";
  });

  // Fonction pour ajouter une vidéo distante dans la grille
  function addRemoteVideo(stream, id) {
    const container = document.createElement('div');
    container.id = `remote_${id}`;
    container.className = "video-card draggable";
    container.style.height = "200px";
    const videoElem = document.createElement('video');
    videoElem.autoplay = true;
    videoElem.playsInline = true;
    videoElem.srcObject = stream;
    videoElem.className = "w-full h-full object-cover";
    container.appendChild(videoElem);
    document.getElementById('remoteVideos').appendChild(container);
    interact(container)
      .draggable({
        inertia: true,
        modifiers: [
          interact.modifiers.restrictRect({ restriction: 'parent', endOnly: true })
        ],
        listeners: {
          move (event) {
            const target = event.target;
            const x = (parseFloat(target.getAttribute('data-x')) || 0) + event.dx;
            const y = (parseFloat(target.getAttribute('data-y')) || 0) + event.dy;
            target.style.transform = `translate(${x}px, ${y}px)`;
            target.setAttribute('data-x', x);
            target.setAttribute('data-y', y);
          }
        }
      });
  }
  
  // Rendre le conteneur du flux local draggable uniquement
  interact('#localStreamWrapper')
    .draggable({
      inertia: true,
      modifiers: [
        interact.modifiers.restrictRect({ restriction: 'body', endOnly: true })
      ],
      listeners: {
        move (event) {
          const target = event.target;
          const x = (parseFloat(target.getAttribute('data-x')) || 0) + event.dx;
          const y = (parseFloat(target.getAttribute('data-y')) || 0) + event.dy;
          target.style.transform = `translate(${x}px, ${y}px)`;
          target.setAttribute('data-x', x);
          target.setAttribute('data-y', y);
        }
      }
    });
  
  // Rendre le conteneur du partage d'écran draggable uniquement
  interact('#localScreenWrapper')
    .draggable({
      inertia: true,
      modifiers: [
        interact.modifiers.restrictRect({ restriction: 'body', endOnly: true })
      ],
      listeners: {
        move (event) {
          const target = event.target;
          const x = (parseFloat(target.getAttribute('data-x')) || 0) + event.dx;
          const y = (parseFloat(target.getAttribute('data-y')) || 0) + event.dy;
          target.style.transform = `translate(${x}px, ${y}px)`;
          target.setAttribute('data-x', x);
          target.setAttribute('data-y', y);
        }
      }
    });
  
  // Exemple de simulation d'ajout d'une vidéo distante (à remplacer par votre logique réelle)
  /*
  setTimeout(() => {
    navigator.mediaDevices.getUserMedia({ video: true, audio: false }).then(remoteStream => {
      addRemoteVideo(remoteStream, 'demo1');
    });
  }, 8000);
  */
});
