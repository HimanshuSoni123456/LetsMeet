import React, { useEffect, useRef, useState } from 'react';
import io from "socket.io-client";
import { Badge, IconButton, TextField } from '@mui/material';
import { Button } from '@mui/material';
import VideocamIcon from '@mui/icons-material/Videocam';
import VideocamOffIcon from '@mui/icons-material/VideocamOff'
import styles from "../styles/videoComponent.module.css";
import CallEndIcon from '@mui/icons-material/CallEnd'
import MicIcon from '@mui/icons-material/Mic'
import MicOffIcon from '@mui/icons-material/MicOff'
import ScreenShareIcon from '@mui/icons-material/ScreenShare';
import StopScreenShareIcon from '@mui/icons-material/StopScreenShare'
import ChatIcon from '@mui/icons-material/Chat'

const server_url = 'YOUR_SERVER_URL_HERE';

var connections = {};

const peerConfigConnections = {
    "iceServers": [
        { "urls": "stun:stun.l.google.com:19302" }
    ]
};

// Helper function for creating a "black" video stream when video is off.
const black = ({ width = 640, height = 480 } = {}) => {
    const canvas = Object.assign(document.createElement("canvas"), { width, height });
    canvas.getContext('2d').fillRect(0, 0, width, height);
    const stream = canvas.captureStream();
    return Object.assign(stream.getVideoTracks()[0], { enabled: false });
};

// Helper function for creating a "silent" audio stream when audio is off.
const silence = () => {
    const ctx = new AudioContext();
    const oscillator = ctx.createOscillator();
    const dst = ctx.createMediaStreamDestination();
    oscillator.connect(dst);
    oscillator.start();
    return Object.assign(dst.stream.getAudioTracks()[0], { enabled: false });
};

export default function VideoMeetComponent() {

    const socketRef = useRef();
    const socketIdRef = useRef();
    const localVideoref = useRef();

    const [videoAvailable, setVideoAvailable] = useState(true);
    const [audioAvailable, setAudioAvailable] = useState(true);
    const [video, setVideo] = useState(true);
    const [audio, setAudio] = useState(true);
    const [screen, setScreen] = useState(false);
    const [showModal, setModal] = useState(true);
    const [screenAvailable, setScreenAvailable] = useState(false);
    const [messages, setMessages] = useState([]);
    const [message, setMessage] = useState("");
    const [newMessages, setNewMessages] = useState(0);
    const [askForUsername, setAskForUsername] = useState(true);
    const [username, setUsername] = useState("");
    const [videos, setVideos] = useState([]);

    useEffect(() => {
        getPermissions();
    }, []);

    useEffect(() => {
        getUserMedia();
    }, [video, audio]);

    useEffect(() => {
        if (screen) {
            getDislayMedia();
        } else {
            if (window.localStream && window.localStream.getVideoTracks().some(track => track.label.includes('screen'))) {
                try {
                    window.localStream.getTracks().forEach(track => track.stop());
                } catch (e) { console.error(e); }
                getUserMedia();
            }
        }
    }, [screen]);

    const getPermissions = async () => {
        try {
            const videoPermission = await navigator.mediaDevices.getUserMedia({ video: true });
            setVideoAvailable(!!videoPermission.getVideoTracks().length);
            videoPermission.getTracks().forEach(track => track.stop());

            const audioPermission = await navigator.mediaDevices.getUserMedia({ audio: true });
            setAudioAvailable(!!audioPermission.getAudioTracks().length);
            audioPermission.getTracks().forEach(track => track.stop());

            setScreenAvailable(!!navigator.mediaDevices.getDisplayMedia);

            if (videoAvailable || audioAvailable) {
                const userMediaStream = await navigator.mediaDevices.getUserMedia({ video: videoAvailable, audio: audioAvailable });
                window.localStream = userMediaStream;
                if (localVideoref.current) {
                    localVideoref.current.srcObject = userMediaStream;
                }
            }
        } catch (error) {
            console.error(error);
            setVideoAvailable(false);
            setAudioAvailable(false);
        }
    };

    const getUserMedia = async () => {
        try {
            if (window.localStream) {
                window.localStream.getTracks().forEach(track => track.stop());
            }

            if (video || audio) {
                const stream = await navigator.mediaDevices.getUserMedia({ video: video && videoAvailable, audio: audio && audioAvailable });
                window.localStream = stream;
                if (localVideoref.current) {
                    localVideoref.current.srcObject = stream;
                }

                for (let id in connections) {
                    if (id === socketIdRef.current) continue;
                    stream.getTracks().forEach(track => {
                        connections[id].getSenders().forEach(sender => {
                            if (sender.track && sender.track.kind === track.kind) {
                                sender.replaceTrack(track);
                            }
                        });
                    });
                }
            } else {
                const blackSilence = () => new MediaStream([black(), silence()]);
                window.localStream = blackSilence();
                if (localVideoref.current) {
                    localVideoref.current.srcObject = window.localStream;
                }
                for (let id in connections) {
                    if (id === socketIdRef.current) continue;
                    window.localStream.getTracks().forEach(track => {
                        connections[id].getSenders().forEach(sender => {
                            if (sender.track && sender.track.kind === track.kind) {
                                sender.replaceTrack(track);
                            }
                        });
                    });
                }
            }
        } catch (e) {
            console.error(e);
        }
    };

    const getDislayMedia = async () => {
        try {
            if (window.localStream) {
                window.localStream.getTracks().forEach(track => track.stop());
            }

            const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
            window.localStream = stream;
            localVideoref.current.srcObject = stream;

            for (let id in connections) {
                if (id === socketIdRef.current) continue;
                stream.getTracks().forEach(track => {
                    connections[id].getSenders().forEach(sender => {
                        if (sender.track && sender.track.kind === track.kind) {
                            sender.replaceTrack(track);
                        }
                    });
                });
            }

            stream.getTracks().forEach(track => track.onended = () => {
                setScreen(false);
                getUserMedia();
            });
        } catch (e) {
            console.error(e);
            setScreen(false);
        }
    };

    const gotMessageFromServer = (fromId, message) => {
        var signal = JSON.parse(message);

        if (fromId !== socketIdRef.current) {
            if (signal.sdp) {
                connections[fromId].setRemoteDescription(new RTCSessionDescription(signal.sdp)).then(() => {
                    if (signal.sdp.type === 'offer') {
                        connections[fromId].createAnswer().then((description) => {
                            connections[fromId].setLocalDescription(description).then(() => {
                                socketRef.current.emit('signal', fromId, JSON.stringify({ 'sdp': connections[fromId].localDescription }));
                            }).catch(e => console.error(e));
                        }).catch(e => console.error(e));
                    }
                }).catch(e => console.error(e));
            }
            if (signal.ice) {
                connections[fromId].addIceCandidate(new RTCIceCandidate(signal.ice)).catch(e => console.error(e));
            }
        }
    };

    const connectToSocketServer = () => {
        socketRef.current = io.connect(server_url, { secure: false });

        socketRef.current.on('signal', gotMessageFromServer);

        socketRef.current.on('connect', () => {
            socketRef.current.emit('join-call', window.location.href);
            socketIdRef.current = socketRef.current.id;

            socketRef.current.on('user-left', (id) => {
                setVideos((prevVideos) => prevVideos.filter((video) => video.socketId !== id));
                if (connections[id]) {
                    connections[id].close();
                    delete connections[id];
                }
            });

            socketRef.current.on('user-joined', (newUserId, clients) => {
                clients.forEach((peerId) => {
                    if (peerId !== socketIdRef.current) {
                        const peerConnection = new RTCPeerConnection(peerConfigConnections);
                        connections[peerId] = peerConnection;

                        // Event listener for when the remote peer adds a new track (video/audio)
                        peerConnection.ontrack = (event) => {
                            setVideos(prevVideos => {
                                const existingVideo = prevVideos.find(v => v.socketId === peerId);
                                if (existingVideo) {
                                    return prevVideos.map(v =>
                                        v.socketId === peerId ? { ...v, stream: event.streams[0] } : v
                                    );
                                } else {
                                    return [...prevVideos, {
                                        socketId: peerId,
                                        stream: event.streams[0],
                                    }];
                                }
                            });
                        };

                        // Event listener for receiving the data channel from the remote peer
                        peerConnection.ondatachannel = (event) => {
                            const dataChannel = event.channel;
                            dataChannel.onmessage = (event) => {
                                try {
                                    const messageData = JSON.parse(event.data);
                                    addMessage(messageData.data, messageData.sender, peerId);
                                } catch (e) {
                                    console.error("Failed to parse chat message:", e);
                                }
                            };
                            peerConnection.dataChannel = dataChannel;
                        };

                        peerConnection.onicecandidate = function (event) {
                            if (event.candidate != null) {
                                socketRef.current.emit('signal', peerId, JSON.stringify({ 'ice': event.candidate }));
                            }
                        };
                        
                        // Add local tracks to the new connection
                        if (window.localStream) {
                            window.localStream.getTracks().forEach(track => {
                                peerConnection.addTrack(track, window.localStream);
                            });
                        }

                        // For the new user joining, all existing peers need to create an offer
                        if (newUserId === peerId) {
                            peerConnection.createOffer().then((description) => {
                                peerConnection.setLocalDescription(description).then(() => {
                                    socketRef.current.emit('signal', peerId, JSON.stringify({ 'sdp': peerConnection.localDescription }));
                                }).catch(e => console.error(e));
                            }).catch(e => console.error(e));
                        }
                    }
                });

                // Create connections for the new user
                if (newUserId === socketIdRef.current) {
                    clients.forEach(existingPeerId => {
                        if (existingPeerId !== newUserId) {
                            const peerConnection = new RTCPeerConnection(peerConfigConnections);
                            connections[existingPeerId] = peerConnection;

                            peerConnection.ontrack = (event) => {
                                setVideos(prevVideos => {
                                    const existingVideo = prevVideos.find(v => v.socketId === existingPeerId);
                                    if (existingVideo) {
                                        return prevVideos.map(v =>
                                            v.socketId === existingPeerId ? { ...v, stream: event.streams[0] } : v
                                        );
                                    } else {
                                        return [...prevVideos, {
                                            socketId: existingPeerId,
                                            stream: event.streams[0],
                                        }];
                                    }
                                });
                            };

                            const dataChannel = peerConnection.createDataChannel("chat");
                            dataChannel.onopen = () => {
                                console.log("Data channel opened for peer:", existingPeerId);
                            };
                            dataChannel.onmessage = (event) => {
                                try {
                                    const messageData = JSON.parse(event.data);
                                    addMessage(messageData.data, messageData.sender, existingPeerId);
                                } catch (e) {
                                    console.error("Failed to parse chat message:", e);
                                }
                            };
                            peerConnection.dataChannel = dataChannel;

                            peerConnection.onicecandidate = function (event) {
                                if (event.candidate != null) {
                                    socketRef.current.emit('signal', existingPeerId, JSON.stringify({ 'ice': event.candidate }));
                                }
                            };

                            if (window.localStream) {
                                window.localStream.getTracks().forEach(track => {
                                    peerConnection.addTrack(track, window.localStream);
                                });
                            }

                            peerConnection.createOffer().then((description) => {
                                peerConnection.setLocalDescription(description).then(() => {
                                    socketRef.current.emit('signal', existingPeerId, JSON.stringify({ 'sdp': peerConnection.localDescription }));
                                }).catch(e => console.error(e));
                            }).catch(e => console.error(e));
                        }
                    });
                }
            });
        });
    };

    let handleVideo = () => {
        setVideo(!video);
    };
    let handleAudio = () => {
        setAudio(!audio);
    };

    let handleScreen = () => {
        setScreen(!screen);
    };

    let handleEndCall = () => {
        try {
            if (window.localStream) {
                window.localStream.getTracks().forEach(track => track.stop());
            }
        } catch (e) { console.error(e); }
        window.location.href = "/";
    };

    let handleMessage = (e) => {
        setMessage(e.target.value);
    };

    const addMessage = (data, sender, socketIdSender) => {
        setMessages((prevMessages) => [
            ...prevMessages,
            { sender: sender, data: data }
        ]);
        if (socketIdSender !== socketIdRef.current) {
            setNewMessages((prevNewMessages) => prevNewMessages + 1);
        }
    };

    let sendMessage = () => {
        const chatMessage = JSON.stringify({
            sender: username,
            data: message
        });

        addMessage(message, username, socketIdRef.current);
        setMessage("");
        
        for (const id in connections) {
            const dataChannel = connections[id].dataChannel;
            if (dataChannel && dataChannel.readyState === 'open') {
                dataChannel.send(chatMessage);
            } else {
                console.warn("Data channel not open for peer:", id);
            }
        }
    };

    let connect = () => {
        setAskForUsername(false);
        getUserMedia();
        connectToSocketServer();
    };

    return (
        <div>
            {askForUsername ? (
                <div className={styles.lobby}>
                    <h2>Enter into Lobby</h2>
                    <TextField
                        id="outlined-basic"
                        label="Username"
                        value={username}
                        onChange={e => setUsername(e.target.value)}
                        variant="outlined"
                        sx={{
                            '& .MuiInputBase-input': { color: 'white' },
                            '& .MuiOutlinedInput-root': {
                                '& fieldset': { borderColor: 'white' },
                                '&:hover fieldset': { borderColor: 'white' },
                                '&.Mui-focused fieldset': { borderColor: 'white' },
                            },
                            '& .MuiInputLabel-root': { color: 'white' },
                            '& .MuiInputLabel-root.Mui-focused': { color: 'white' },
                        }}
                    />
                    <Button variant="contained" onClick={connect}>
                        Connect
                    </Button>
                    <div>
                        <video ref={localVideoref} className={styles.lobbyVideo} autoPlay muted></video>
                    </div>
                </div>
            ) : (
                <div className={styles.meetVideoContainer}>
                    {showModal && (
                        <div className={styles.chatRoom}>
                            <div className={styles.chatContainer}>
                                <h1>Chat</h1>
                                <div className={styles.chattingDisplay}>
                                    {messages.length !== 0 ? (
                                        messages.map((item, index) => (
                                            <div style={{ marginBottom: '20px' }} key={index}>
                                                <p style={{ fontWeight: 'bold' }}>{item.sender}</p>
                                                <p>{item.data}</p>
                                            </div>
                                        ))
                                    ) : (
                                        <p>No Messages Yet</p>
                                    )}
                                </div>
                                <div className={styles.chattingArea}>
                                    <TextField
                                        value={message}
                                        onChange={handleMessage}
                                        label="Enter Your chat"
                                        variant="outlined"
                                        onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                                        sx={{
                                            flexGrow: 1,
                                            '& .MuiInputBase-input': { color: 'black' },
                                            '& .MuiOutlinedInput-root': {
                                                '& fieldset': { borderColor: 'black' },
                                                '&:hover fieldset': { borderColor: 'black' },
                                                '&.Mui-focused fieldset': { borderColor: 'black' },
                                            },
                                            '& .MuiInputLabel-root': { color: 'black' },
                                            '& .MuiInputLabel-root.Mui-focused': { color: 'black' },
                                        }}
                                    />
                                    <Button variant="contained" onClick={sendMessage}>
                                        Send
                                    </Button>
                                </div>
                            </div>
                        </div>
                    )}
                    <div className={styles.buttonContainers}>
                        <IconButton onClick={handleVideo} style={{ color: 'white' }}>
                            {video ? <VideocamIcon /> : <VideocamOffIcon />}
                        </IconButton>
                        <IconButton onClick={handleEndCall} style={{ color: 'red' }}>
                            <CallEndIcon />
                        </IconButton>
                        <IconButton onClick={handleAudio} style={{ color: 'white' }}>
                            {audio ? <MicIcon /> : <MicOffIcon />}
                        </IconButton>
                        {screenAvailable && (
                            <IconButton onClick={handleScreen} style={{ color: 'white' }}>
                                {screen ? <StopScreenShareIcon /> : <ScreenShareIcon />}
                            </IconButton>
                        )}
                        <Badge badgeContent={newMessages} max={999} color="secondary">
                            <IconButton onClick={() => setModal(!showModal)} style={{ color: 'white' }}>
                                <ChatIcon />
                            </IconButton>
                        </Badge>
                    </div>
                    <video className={styles.meetUserVideo} ref={localVideoref} autoPlay muted></video>
                    <div className={styles.conferenceView}>
                        {videos.map((video) => (
                            <div key={video.socketId}>
                                <video
                                    className={styles.conferenceVideo}
                                    data-socket={video.socketId}
                                    ref={(ref) => {
                                        if (ref && video.stream) {
                                            ref.srcObject = video.stream;
                                        }
                                    }}
                                    autoPlay
                                ></video>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}