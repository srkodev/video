const express = require('express');
const http = require('http');
const path = require('path');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

// Servir les fichiers statiques
app.use(express.static(path.join(__dirname, '../public')));

// Structures de données
let rooms = {};         // roomID -> [liste des socket.id]
let socketToRoom = {};  // socket.id -> roomID
let socketToName = {};  // socket.id -> nom
let micStatus = {};     // socket.id -> 'on'/'off'
let videoStatus = {};   // socket.id -> 'on'/'off'

io.on('connection', socket => {
  console.log(`Nouvelle connexion: ${socket.id}`);

  socket.on('join-room', (roomId, userName) => {
    socket.join(roomId);
    socketToRoom[socket.id] = roomId;
    socketToName[socket.id] = userName || 'Utilisateur';
    micStatus[socket.id] = 'on';
    videoStatus[socket.id] = 'on';

    if (rooms[roomId]) {
      rooms[roomId].push(socket.id);
      // Informer les autres participants
      socket.to(roomId).emit('user-joined', socket.id, socketToName[socket.id]);
      // Informer le nouvel arrivant des gens déjà présents
      io.to(socket.id).emit('room-users', rooms[roomId].filter(id => id !== socket.id));
    } else {
      // Nouvelle salle
      rooms[roomId] = [socket.id];
      io.to(socket.id).emit('room-users', []);
    }
    // Nombre d’utilisateurs
    io.to(roomId).emit('user-count', rooms[roomId].length);
    console.log(`${userName} a rejoint la room ${roomId}`);
  });

  // Réception message chat
  socket.on('chat-message', (message, userName) => {
    const roomId = socketToRoom[socket.id];
    if (roomId) {
      io.to(roomId).emit('chat-message', message, userName, new Date().toLocaleTimeString());
    }
  });

  // Toggle audio/vidéo
  socket.on('toggle-media', (mediaType, state) => {
    if (mediaType === 'audio') {
      micStatus[socket.id] = state;
    } else if (mediaType === 'video') {
      videoStatus[socket.id] = state;
    }
    // Notifier la room
    socket.to(socketToRoom[socket.id]).emit('media-toggled', socket.id, mediaType, state);
  });

  // Signaling WebRTC
  socket.on('video-offer', (offer, targetId) => {
    io.to(targetId).emit('video-offer', offer, socket.id, socketToName[socket.id]);
  });
  socket.on('video-answer', (answer, targetId) => {
    io.to(targetId).emit('video-answer', answer, socket.id);
  });
  socket.on('new-ice-candidate', (candidate, targetId) => {
    io.to(targetId).emit('new-ice-candidate', candidate, socket.id);
  });

  // Quitter la room
  socket.on('leave-room', (roomId) => {
    socket.leave(roomId);
    // On émet manuellement comme s’il s’était déconnecté
    socket.disconnect();
  });

  // Déconnexion
  socket.on('disconnect', () => {
    const roomId = socketToRoom[socket.id];
    if (roomId && rooms[roomId]) {
      socket.to(roomId).emit('user-left', socket.id, socketToName[socket.id]);
      rooms[roomId] = rooms[roomId].filter(id => id !== socket.id);
      io.to(roomId).emit('user-count', rooms[roomId].length);
      delete socketToRoom[socket.id];
      delete socketToName[socket.id];
      delete micStatus[socket.id];
      delete videoStatus[socket.id];
    }
    console.log(`Socket ${socket.id} déconnecté`);
  });
});

server.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
});
