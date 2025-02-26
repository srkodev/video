import React, { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import Peer from 'simple-peer';

// Import MUI
import {
  Avatar,
  Box,
  Button,
  IconButton,
  Slider,
  TextField,
  Typography,
  Tooltip,
} from '@mui/material';

// Import des icônes Material UI
import MicIcon from '@mui/icons-material/Mic';
import MicOffIcon from '@mui/icons-material/MicOff';
import VideocamIcon from '@mui/icons-material/Videocam';
import VideocamOffIcon from '@mui/icons-material/VideocamOff';
import ScreenShareIcon from '@mui/icons-material/ScreenShare';
import StopScreenShareIcon from '@mui/icons-material/StopScreenShare';
import SendIcon from '@mui/icons-material/Send';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';

const App = () => {
  // État pour la connexion
  const [name, setName] = useState('');
  const [room, setRoom] = useState('');
  const [joined, setJoined] = useState(false);

  // Chat
  const [messages, setMessages] = useState([]);
  const [showChat, setShowChat] = useState(true);

  // WebRTC
  const [remoteUsers, setRemoteUsers] = useState({});
  const [speakingUsers, setSpeakingUsers] = useState({});
  const [localSpeaking, setLocalSpeaking] = useState(false);

  // Statuts
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [sharing, setSharing] = useState(false);

  // Volume
  const [volumeMap, setVolumeMap] = useState({});

  // Références
  const localVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const socketRef = useRef(null);
  const peersRef = useRef({});
  const videoRefs = useRef({});

  // Attache un stream à un élément <video>
  const attachStream = (videoEl, stream, userId, type) => {
    if (videoEl && stream) {
      videoEl.srcObject = stream;
      videoEl.volume = volumeMap[userId] !== undefined ? volumeMap[userId] : 1;
      videoEl.play();
      if (!videoRefs.current[userId]) {
        videoRefs.current[userId] = {};
      }
      videoRefs.current[userId][type] = videoEl;
    }
  };

  // Connexion à la conférence
  const joinConference = async () => {
    if (!name || !room) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        localVideoRef.current.muted = true;
        localVideoRef.current.play();
      }

      socketRef.current = io(); // même domaine/port par défaut

      // Quand on reçoit la liste des utilisateurs déjà présents
      socketRef.current.on('roomUsers', (users) => {
        users.forEach((user) => {
          const peer = new Peer({
            initiator: false,
            trickle: true,
            stream: localStreamRef.current,
            config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] },
          });
          peersRef.current[user.id] = peer;
          peer.on('signal', (signalData) => {
            socketRef.current.emit('signal', { to: user.id, data: signalData });
          });
          peer.on('stream', (remoteStream) => {
            setRemoteUsers((prev) => {
              const prevEntry = prev[user.id] || { name: user.name };
              if (!prevEntry.stream) {
                prevEntry.stream = remoteStream;
              } else {
                prevEntry.screenStream = remoteStream;
              }
              return { ...prev, [user.id]: prevEntry };
            });
          });
        });
      });

      // Quand un nouvel utilisateur rejoint
      socketRef.current.on('userJoined', ({ id, name: userName }) => {
        const peer = new Peer({
          initiator: true,
          trickle: true,
          stream: localStreamRef.current,
          config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] },
        });
        peersRef.current[id] = peer;
        peer.on('signal', (signalData) => {
          socketRef.current.emit('signal', { to: id, data: signalData });
        });
        peer.on('stream', (remoteStream) => {
          setRemoteUsers((prev) => {
            const prevEntry = prev[id] || { name: userName };
            if (!prevEntry.stream) {
              prevEntry.stream = remoteStream;
            } else {
              prevEntry.screenStream = remoteStream;
            }
            return { ...prev, [id]: prevEntry };
          });
        });
        setRemoteUsers((prev) => ({ ...prev, [id]: { name: userName } }));
      });

      // Quand un utilisateur quitte
      socketRef.current.on('userLeft', ({ id }) => {
        if (peersRef.current[id]) {
          peersRef.current[id].destroy();
          delete peersRef.current[id];
        }
        setRemoteUsers((prev) => {
          const newUsers = { ...prev };
          delete newUsers[id];
          return newUsers;
        });
        setSpeakingUsers((prev) => {
          const newStates = { ...prev };
          delete newStates[id];
          return newStates;
        });
        setVolumeMap((prev) => {
          const newVol = { ...prev };
          delete newVol[id];
          return newVol;
        });
      });

      // Signaux WebRTC
      socketRef.current.on('signal', ({ from, data }) => {
        const peer = peersRef.current[from];
        if (peer) {
          peer.signal(data);
        }
      });

      // Réception d’un message chat
      socketRef.current.on('chatMessage', ({ from, message }) => {
        setMessages((prev) => [...prev, { from, text: message }]);
      });

      // Indicateur "parle"
      socketRef.current.on('speaking', ({ id, speaking }) => {
        setSpeakingUsers((prev) => ({ ...prev, [id]: speaking }));
      });

      // Partage d’écran d’un autre
      socketRef.current.on('userStartedSharing', ({ id }) => {
        // Marquer si besoin
      });
      socketRef.current.on('userStoppedSharing', ({ id }) => {
        setRemoteUsers((prev) => {
          if (prev[id] && prev[id].screenStream) {
            const newData = { ...prev };
            delete newData[id].screenStream;
            return newData;
          }
          return prev;
        });
      });

      // On rejoint la salle
      socketRef.current.emit('join', { room, name });
      setJoined(true);
      startLocalVolumeMonitor();
    } catch (err) {
      console.error('Erreur caméra/micro :', err);
      alert("Impossible d'accéder à la caméra/micro.");
    }
  };

  // Détection du volume local
  const startLocalVolumeMonitor = () => {
    if (!localStreamRef.current) return;
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.8;
    const microphone = audioContext.createMediaStreamSource(localStreamRef.current);
    microphone.connect(analyser);
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    let wasSpeaking = false;
    setInterval(() => {
      analyser.getByteFrequencyData(dataArray);
      let valuesSum = 0;
      for (let i = 0; i < dataArray.length; i++) valuesSum += dataArray[i];
      const average = valuesSum / dataArray.length;
      const speaking = average > 20; // seuil
      setLocalSpeaking(speaking);
      if (speaking !== wasSpeaking) {
        wasSpeaking = speaking;
        if (socketRef.current) {
          socketRef.current.emit('speaking', { speaking });
        }
      }
    }, 200);
  };

  // Envoi d’un message chat
  const sendMessage = (text) => {
    if (!text.trim()) return;
    socketRef.current?.emit('chatMessage', text);
    // L’ajout local est géré par la réception "chatMessage"
  };

  // Contrôle micro
  const toggleMic = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setMicOn(audioTrack.enabled);
      }
    }
  };

  // Contrôle caméra
  const toggleCam = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setCamOn(videoTrack.enabled);
      }
    }
  };

  // Partage d'écran
  const toggleScreenShare = async () => {
    if (!sharing) {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        screenStreamRef.current = screenStream;
        setSharing(true);
        socketRef.current?.emit('startShare');
        Object.keys(peersRef.current).forEach((peerId) => {
          peersRef.current[peerId].addStream(screenStream);
        });
        screenStream.getVideoTracks()[0].addEventListener('ended', () => {
          stopScreenShare();
        });
      } catch (err) {
        console.error("Erreur partage d'écran :", err);
      }
    } else {
      stopScreenShare();
    }
  };

  const stopScreenShare = () => {
    if (!screenStreamRef.current) return;
    screenStreamRef.current.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;
    setSharing(false);
    socketRef.current?.emit('stopShare');
  };

  // Volume individuel
  const handleVolumeChange = (userId, newVolume) => {
    setVolumeMap((prev) => ({ ...prev, [userId]: newVolume }));
    if (videoRefs.current[userId]) {
      // MàJ du volume sur la vidéo
      if (videoRefs.current[userId].streamEl) {
        videoRefs.current[userId].streamEl.volume = newVolume;
      }
      if (videoRefs.current[userId].screenEl) {
        videoRefs.current[userId].screenEl.volume = newVolume;
      }
    }
  };

  // Plein écran
  const requestFullScreen = (videoEl) => {
    if (!videoEl) return;
    if (videoEl.requestFullscreen) {
      videoEl.requestFullscreen();
    } else if (videoEl.webkitRequestFullscreen) {
      videoEl.webkitRequestFullscreen();
    } else if (videoEl.mozRequestFullScreen) {
      videoEl.mozRequestFullScreen();
    } else if (videoEl.msRequestFullscreen) {
      videoEl.msRequestFullscreen();
    }
  };

  // --------------------
  // Écran de connexion
  // --------------------
  if (!joined) {
    return (
      <Box
        sx={{
          p: 4,
          textAlign: 'center',
          minHeight: '60vh',
          maxWidth: 400,
          margin: '0 auto',
          mt: 6,
          borderRadius: 2,
          backgroundColor: 'rgba(44,44,46,0.6)',
          backdropFilter: 'blur(10px)',
        }}
      >
        <Typography variant="h4" gutterBottom sx={{ mb: 3, fontWeight: 'bold' }}>
          Rejoindre la conférence
        </Typography>
        <TextField
          label="Pseudo"
          variant="outlined"
          value={name}
          onChange={(e) => setName(e.target.value)}
          sx={{ m: 1, width: '100%' }}
        />
        <TextField
          label="Nom de la salle"
          variant="outlined"
          value={room}
          onChange={(e) => setRoom(e.target.value)}
          sx={{ m: 1, width: '100%' }}
        />
        <Box>
          <Button
            variant="contained"
            color="primary"
            onClick={joinConference}
            sx={{
              mt: 3,
              fontWeight: 'bold',
              borderRadius: 12,
              px: 4,
            }}
          >
            Entrer
          </Button>
        </Box>
      </Box>
    );
  }

  // -----------------------------
  // Écran principal de conférence
  // -----------------------------
  return (
    <Box
      sx={{
        display: 'flex',
        height: '100vh',
        position: 'relative',
        color: 'text.primary',
      }}
    >
      {/* Liste participants (panneau gauche) */}
      <Box
        sx={{
          width: 260,
          borderRight: '1px solid rgba(255,255,255,0.1)',
          p: 2,
          overflowY: 'auto',
          backgroundColor: 'rgba(28,28,30,0.5)',
          backdropFilter: 'blur(12px)',
        }}
      >
        <Typography variant="h6" sx={{ mb: 2, fontWeight: 'bold' }}>
          Participants
        </Typography>

        {/* Local user */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            mb: 2,
            borderRadius: 2,
            p: 1,
            backgroundColor: 'rgba(255,255,255,0.06)',
          }}
        >
          <Avatar
            sx={{
              width: 50,
              height: 50,
              mr: 2,
              border: localSpeaking ? '2px solid #34C759' : '2px solid transparent',
              transition: 'border 0.3s',
              backgroundColor: '#007AFF',
              color: '#fff',
            }}
          >
            {name.charAt(0).toUpperCase()}
          </Avatar>
          <Box sx={{ flex: 1 }}>
            <Typography sx={{ fontWeight: 600 }}>{name}</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              (vous)
            </Typography>
          </Box>
          <MicIcon
            fontSize="small"
            sx={{
              mr: 1,
              color: micOn ? '#007AFF' : 'rgba(255,255,255,0.3)',
            }}
          />
          <VideocamIcon
            fontSize="small"
            sx={{
              color: camOn ? '#007AFF' : 'rgba(255,255,255,0.3)',
            }}
          />
        </Box>

        {/* Remote users */}
        {Object.entries(remoteUsers).map(([id, user]) => (
          <Box
            key={id}
            sx={{
              display: 'flex',
              alignItems: 'center',
              mb: 2,
              borderRadius: 2,
              p: 1,
              backgroundColor: 'rgba(255,255,255,0.06)',
            }}
          >
            <Avatar
              sx={{
                width: 50,
                height: 50,
                mr: 2,
                border: speakingUsers[id] ? '2px solid #34C759' : '2px solid transparent',
                transition: 'border 0.3s',
                backgroundColor: '#8E8E93',
                color: '#fff',
              }}
            >
              {user.name.charAt(0).toUpperCase()}
            </Avatar>
            <Box sx={{ flex: 1 }}>
              <Typography sx={{ fontWeight: 600 }}>{user.name}</Typography>
            </Box>
            <Slider
              value={(volumeMap[id] !== undefined ? volumeMap[id] : 1) * 100}
              onChange={(e, val) => handleVolumeChange(id, val / 100)}
              min={0}
              max={100}
              size="small"
              sx={{
                width: 80,
                color: '#007AFF',
              }}
              aria-label="Volume"
            />
          </Box>
        ))}
      </Box>

      {/* Zone centrale : vidéos */}
      <Box
        sx={{
          flex: 1,
          p: 2,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 2,
          justifyContent: 'center',
          alignContent: 'flex-start',
          overflowY: 'auto',
        }}
      >
        {/* Vidéo locale */}
        <Box
          sx={{
            position: 'relative',
            width: '320px',
            maxWidth: '45%',
            borderRadius: 2,
            overflow: 'hidden',
            boxShadow: localSpeaking
              ? '0 0 10px rgba(52,199,89,0.8)'
              : '0 0 6px rgba(0,0,0,0.3)',
            transition: 'box-shadow 0.3s',
          }}
        >
          <Tooltip title="Basculer en plein écran">
            <IconButton
              sx={{
                position: 'absolute',
                top: 8,
                right: 8,
                zIndex: 2,
                color: '#fff',
                backgroundColor: 'rgba(0,0,0,0.4)',
                ':hover': { backgroundColor: 'rgba(0,0,0,0.6)' },
              }}
              onClick={() => requestFullScreen(localVideoRef.current)}
            >
              <FullscreenIcon />
            </IconButton>
          </Tooltip>

          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            style={{ width: '100%', display: 'block' }}
          />
          <Typography
            variant="caption"
            sx={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              bgcolor: 'rgba(0,0,0,0.4)',
              color: '#fff',
              textAlign: 'center',
              py: 0.5,
              fontWeight: 600,
            }}
          >
            {name} (vous)
          </Typography>
        </Box>

        {/* Vidéos des utilisateurs distants */}
        {Object.entries(remoteUsers).map(([id, user]) => {
          const elements = [];
          // Caméra distante
          if (user.stream) {
            elements.push(
              <Box
                key={id + '-cam'}
                sx={{
                  position: 'relative',
                  width: '320px',
                  maxWidth: '45%',
                  borderRadius: 2,
                  overflow: 'hidden',
                  boxShadow: speakingUsers[id]
                    ? '0 0 10px rgba(52,199,89,0.8)'
                    : '0 0 6px rgba(0,0,0,0.3)',
                  transition: 'box-shadow 0.3s',
                }}
              >
                <Tooltip title="Basculer en plein écran">
                  <IconButton
                    sx={{
                      position: 'absolute',
                      top: 8,
                      right: 8,
                      zIndex: 2,
                      color: '#fff',
                      backgroundColor: 'rgba(0,0,0,0.4)',
                      ':hover': { backgroundColor: 'rgba(0,0,0,0.6)' },
                    }}
                    onClick={() => {
                      const videoEl = videoRefs.current[id]?.streamEl;
                      requestFullScreen(videoEl);
                    }}
                  >
                    <FullscreenIcon />
                  </IconButton>
                </Tooltip>

                <video
                  ref={(el) => attachStream(el, user.stream, id, 'streamEl')}
                  autoPlay
                  playsInline
                  style={{ width: '100%', display: 'block' }}
                />
                <Typography
                  variant="caption"
                  sx={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    bgcolor: 'rgba(0,0,0,0.4)',
                    color: '#fff',
                    textAlign: 'center',
                    py: 0.5,
                    fontWeight: 600,
                  }}
                >
                  {user.name}
                </Typography>
              </Box>
            );
          }
          // Partage d'écran distant
          if (user.screenStream) {
            elements.push(
              <Box
                key={id + '-screen'}
                sx={{
                  position: 'relative',
                  width: '320px',
                  maxWidth: '45%',
                  borderRadius: 2,
                  overflow: 'hidden',
                  boxShadow: speakingUsers[id]
                    ? '0 0 10px rgba(52,199,89,0.8)'
                    : '0 0 6px rgba(0,0,0,0.3)',
                  transition: 'box-shadow 0.3s',
                }}
              >
                <Tooltip title="Basculer en plein écran">
                  <IconButton
                    sx={{
                      position: 'absolute',
                      top: 8,
                      right: 8,
                      zIndex: 2,
                      color: '#fff',
                      backgroundColor: 'rgba(0,0,0,0.4)',
                      ':hover': { backgroundColor: 'rgba(0,0,0,0.6)' },
                    }}
                    onClick={() => {
                      const videoEl = videoRefs.current[id]?.screenEl;
                      requestFullScreen(videoEl);
                    }}
                  >
                    <FullscreenIcon />
                  </IconButton>
                </Tooltip>
                <video
                  ref={(el) => attachStream(el, user.screenStream, id, 'screenEl')}
                  autoPlay
                  playsInline
                  style={{ width: '100%', display: 'block' }}
                />
                <Typography
                  variant="caption"
                  sx={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    bgcolor: 'rgba(0,0,0,0.4)',
                    color: '#fff',
                    textAlign: 'center',
                    py: 0.5,
                    fontWeight: 600,
                  }}
                >
                  {user.name} – écran
                </Typography>
              </Box>
            );
          }
          return elements;
        })}
      </Box>

      {/* Chat (panneau droit) */}
      {showChat && (
        <Box
          sx={{
            width: 320,
            borderLeft: '1px solid rgba(255,255,255,0.1)',
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: 'rgba(28,28,30,0.5)',
            backdropFilter: 'blur(12px)',
          }}
        >
          <Box
            sx={{
              p: 2,
              borderBottom: '1px solid rgba(255,255,255,0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
              Chat
            </Typography>
            {/* Cacher le chat */}
            <IconButton
              sx={{ color: 'rgba(255,255,255,0.7)' }}
              onClick={() => setShowChat(false)}
            >
              <FullscreenExitIcon />
            </IconButton>
          </Box>
          <Box sx={{ flex: 1, p: 2, overflowY: 'auto' }}>
            {messages.map((msg, idx) => (
              <Typography key={idx} variant="body2" sx={{ mb: 1 }}>
                <strong>{msg.from}:</strong> {msg.text}
              </Typography>
            ))}
          </Box>
          <Box
            sx={{
              p: 2,
              borderTop: '1px solid rgba(255,255,255,0.1)',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <TextField
              variant="outlined"
              size="small"
              placeholder="Votre message..."
              fullWidth
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  sendMessage(e.target.value);
                  e.target.value = '';
                }
              }}
              sx={{ mr: 1 }}
            />
            <IconButton
              color="primary"
              onClick={(e) => {
                const input = e.currentTarget.previousElementSibling.querySelector('input');
                if (input) {
                  sendMessage(input.value);
                  input.value = '';
                }
              }}
            >
              <SendIcon />
            </IconButton>
          </Box>
        </Box>
      )}

      {/* Barre d’outils (bas) */}
      <Box
        sx={{
          position: 'absolute',
          bottom: 20,
          left: '50%',
          transform: 'translateX(-50%)',
          bgcolor: 'rgba(28,28,30,0.6)',
          backdropFilter: 'blur(12px)',
          borderRadius: 50,
          px: 2,
          py: 1,
          display: 'flex',
          gap: 2,
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          alignItems: 'center',
        }}
      >
        {/* Micro */}
        <IconButton onClick={toggleMic}>
          {micOn ? (
            <MicIcon sx={{ color: '#fff' }} />
          ) : (
            <MicOffIcon sx={{ color: 'rgba(255,0,0,0.8)' }} />
          )}
        </IconButton>

        {/* Cam */}
        <IconButton onClick={toggleCam}>
          {camOn ? (
            <VideocamIcon sx={{ color: '#fff' }} />
          ) : (
            <VideocamOffIcon sx={{ color: 'rgba(255,0,0,0.8)' }} />
          )}
        </IconButton>

        {/* Partage d'écran */}
        <IconButton onClick={toggleScreenShare}>
          {!sharing ? (
            <ScreenShareIcon sx={{ color: '#fff' }} />
          ) : (
            <StopScreenShareIcon sx={{ color: '#fff176' }} />
          )}
        </IconButton>

        {/* Chat on/off */}
        <IconButton onClick={() => setShowChat(!showChat)}>
          {showChat ? (
            <FullscreenExitIcon sx={{ color: '#fff' }} />
          ) : (
            <FullscreenIcon sx={{ color: '#fff' }} />
          )}
        </IconButton>
      </Box>
    </Box>
  );
};

export default App;
