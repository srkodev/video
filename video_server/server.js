// video_server/server.js
const express = require('express');
const http = require('http');
const path = require('path');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Servir les fichiers statiques depuis le dossier public (situé dans le dossier parent)
app.use(express.static(path.join(__dirname, '../public')));

// Rediriger la racine vers index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

io.on('connection', socket => {
  console.log('Client connecté: ' + socket.id);

  socket.on('join-room', (roomId, userId) => {
    socket.join(roomId);
    console.log(`Utilisateur ${userId} a rejoint la room ${roomId}`);
    // Notifier les autres membres
    socket.to(roomId).emit('user-connected', { userId: socket.id, username: userId });

    socket.on('signal', data => {
      // data contient : roomId, sender, message
      socket.to(data.roomId).emit('signal', { sender: data.sender, message: data.message });
    });

    socket.on('disconnect', () => {
      console.log(`Utilisateur ${userId} a quitté la room ${roomId}`);
      socket.to(roomId).emit('user-disconnected', socket.id);
      
      // Vérifier si la room est vide
      const room = io.sockets.adapter.rooms.get(roomId);
      if (!room || room.size === 0) {
        console.log(`Room ${roomId} est maintenant vide. La room est détruite.`);
        // Ici, effectuez un nettoyage supplémentaire si nécessaire
      }
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Serveur de signalisation en écoute sur le port ${PORT}`);
});
