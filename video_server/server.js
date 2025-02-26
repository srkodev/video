const express = require('express');
const http = require('http');
const path = require('path');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

// Servir les fichiers statiques (HTML, CSS, JS du client)
app.use(express.static(path.join(__dirname, '../public')));

// Structures de données pour gérer les salles et utilisateurs
let rooms = {};         // Associe roomID -> [liste des socket.id des participants]
let socketToRoom = {};  // Associe socket.id -> roomID
let socketToName = {};  // Associe socket.id -> nom d'utilisateur
let micStatus = {};     // Associe socket.id -> état du micro ('on' ou 'off')
let videoStatus = {};   // Associe socket.id -> état de la caméra ('on' ou 'off')

// Gestion des connexions Socket.io
io.on('connection', socket => {
  console.log(`Nouvelle connexion socket: ${socket.id}`);

  // Quand un client rejoint une salle
  socket.on('join-room', (roomId, userName) => {
    socket.join(roomId);                     // Rejoindre la salle Socket.io
    socketToRoom[socket.id] = roomId;
    socketToName[socket.id] = userName || 'Utilisateur';
    micStatus[socket.id] = 'on';
    videoStatus[socket.id] = 'on';

    // Si la salle existe déjà, notifier les autres de la nouvelle entrée
    if (rooms[roomId]) {
      rooms[roomId].push(socket.id);
      // Informer les autres participants qu'un nouvel utilisateur a rejoint
      socket.to(roomId).emit('user-joined', socket.id, socketToName[socket.id], micStatus[socket.id], videoStatus[socket.id]);
      // Envoyer au nouvel utilisateur la liste des utilisateurs déjà présents pour établir les connexions WebRTC
      io.to(socket.id).emit('room-users', rooms[roomId].filter(id => id !== socket.id), socketToName, micStatus, videoStatus);
    } else {
      // Créer une nouvelle salle avec le premier participant
      rooms[roomId] = [socket.id];
      // Informer le nouvel utilisateur qu'il est le premier dans la salle (aucun pair pour l'instant)
      io.to(socket.id).emit('room-users', [], socketToName, micStatus, videoStatus);
    }
    // Mettre à jour le décompte des utilisateurs dans la salle
    io.to(roomId).emit('user-count', rooms[roomId].length);
    console.log(`${userName} a rejoint la salle ${roomId}`);
  });

  // Réception d'un message chat d'un client et retransmission à la salle
  socket.on('chat-message', (message, userName) => {
    const roomId = socketToRoom[socket.id];
    if (roomId) {
      // Diffuser le message à tous les clients de la salle, y compris l'expéditeur
      io.to(roomId).emit('chat-message', message, userName, new Date().toLocaleTimeString());
    }
  });

  // Gestion des actions audio/vidéo (ex: mute, unmute, caméra on/off)
  socket.on('toggle-media', (mediaType, state) => {
    // mediaType: 'audio' ou 'video'; state: 'on' ou 'off'
    if (mediaType === 'audio') {
      micStatus[socket.id] = state;
    } else if (mediaType === 'video') {
      videoStatus[socket.id] = state;
    }
    // Informer les autres participants de l'état mis à jour
    socket.to(socketToRoom[socket.id]).emit('media-toggled', socket.id, mediaType, state);
  });

  // Signaling WebRTC : transfert de l'offre SDP à un autre participant
  socket.on('video-offer', (offer, targetSocketId) => {
    io.to(targetSocketId).emit('video-offer', offer, socket.id, socketToName[socket.id]);
  });

  // Signaling WebRTC : transfert de la réponse SDP à l'offre
  socket.on('video-answer', (answer, targetSocketId) => {
    io.to(targetSocketId).emit('video-answer', answer, socket.id);
  });

  // Signaling WebRTC : transfert des candidats ICE
  socket.on('new-ice-candidate', (candidate, targetSocketId) => {
    io.to(targetSocketId).emit('new-ice-candidate', candidate, socket.id);
  });

  // Gestion de la déconnexion d'un client
  socket.on('disconnect', () => {
    const roomId = socketToRoom[socket.id];
    if (roomId) {
      // Informer les autres participants qu'un utilisateur a quitté la salle
      socket.to(roomId).emit('user-left', socket.id, socketToName[socket.id]);
      // Retirer l'utilisateur de la liste
      rooms[roomId] = rooms[roomId].filter(id => id !== socket.id);
      // Mettre à jour le nombre d'utilisateurs dans la salle
      io.to(roomId).emit('user-count', rooms[roomId].length);
      // Nettoyer les données associées à ce socket
      delete socketToRoom[socket.id];
      delete socketToName[socket.id];
      delete micStatus[socket.id];
      delete videoStatus[socket.id];
    }
    console.log(`Socket ${socket.id} déconnecté`);
  });
});

// Démarrer le serveur
server.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
});
