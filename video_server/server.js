const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Configuration du serveur Socket.io avec CORS pour développement
const io = new Server(server, {
  cors: { origin: '*' }
});

// Servir les fichiers React après build (Production)
app.use(express.static(path.join(__dirname, '../visio-client/build')));

// Route pour servir React
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../visio-client/build', 'index.html'));
});

// Stockage des utilisateurs par salle
const rooms = {}; 
// Format: rooms[roomName] = { socketId: { name: 'Pseudo', isSharing: false, speaking: false, volume: 1 } }

io.on('connection', socket => {
  console.log(`Client connecté: ${socket.id}`);

  // Rejoindre une salle avec un pseudo
  socket.on('join', ({ room, name }) => {
    socket.join(room);

    if (!rooms[room]) rooms[room] = {};
    rooms[room][socket.id] = { 
      name: name, 
      isSharing: false, 
      speaking: false, 
      volume: 1 
    };

    // Envoyer la liste des utilisateurs déjà présents
    const usersInRoom = Object.keys(rooms[room])
      .filter(id => id !== socket.id)
      .map(id => ({
        id,
        name: rooms[room][id].name,
        isSharing: rooms[room][id].isSharing
      }));
      
    socket.emit('roomUsers', usersInRoom);

    // Notifier les autres qu'un utilisateur a rejoint
    socket.to(room).emit('userJoined', { id: socket.id, name });
    console.log(`${name} a rejoint la salle ${room}`);
  });

  // Relayer les signaux WebRTC entre pairs
  socket.on('signal', ({ to, data }) => {
    io.to(to).emit('signal', { from: socket.id, data });
  });

  // Gestion des messages de chat
  socket.on('chatMessage', message => {
    for (const room in rooms) {
      if (rooms[room][socket.id]) {
        const username = rooms[room][socket.id].name;
        io.in(room).emit('chatMessage', { from: username, message });
        break;
      }
    }
  });

  // Détection de parole
  socket.on('speaking', ({ speaking }) => {
    for (const room in rooms) {
      if (rooms[room][socket.id]) {
        rooms[room][socket.id].speaking = speaking;
        socket.to(room).emit('speaking', { id: socket.id, speaking });
        break;
      }
    }
  });

  // Gestion du volume
  socket.on('setVolume', ({ volume }) => {
    for (const room in rooms) {
      if (rooms[room][socket.id]) {
        rooms[room][socket.id].volume = volume;
        socket.to(room).emit('volumeChange', { id: socket.id, volume });
        break;
      }
    }
  });

  // Début du partage d’écran
  socket.on('startShare', () => {
    for (const room in rooms) {
      if (rooms[room][socket.id]) {
        rooms[room][socket.id].isSharing = true;
        socket.to(room).emit('userStartedSharing', { id: socket.id });
        break;
      }
    }
  });

  // Fin du partage d’écran
  socket.on('stopShare', () => {
    for (const room in rooms) {
      if (rooms[room][socket.id]) {
        rooms[room][socket.id].isSharing = false;
        socket.to(room).emit('userStoppedSharing', { id: socket.id });
        break;
      }
    }
  });

  // Déconnexion d'un utilisateur
  socket.on('disconnect', () => {
    console.log(`Client déconnecté: ${socket.id}`);
    
    for (const room in rooms) {
      if (rooms[room][socket.id]) {
        const username = rooms[room][socket.id].name;
        delete rooms[room][socket.id];

        // Informer les autres utilisateurs
        socket.to(room).emit('userLeft', { id: socket.id });

        console.log(`${username} a quitté la salle ${room}`);

        // Supprimer la salle si vide
        if (Object.keys(rooms[room]).length === 0) {
          delete rooms[room];
        }
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Serveur en écoute sur le port ${PORT}`);
});
