import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { SpeechClient } from '@google-cloud/speech';

const app = express();
app.use(cors());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

const speechClient = new SpeechClient({
  credentials: JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS || '{}'),
});

io.on("connection", (socket) => {
  console.log("Client connected");

  let recognizeStream: any = null;

  socket.on("startStream", () => {
    recognizeStream = speechClient
      .streamingRecognize({
        config: {
          encoding: 'WEBM_OPUS',
          sampleRateHertz: 48000,
          languageCode: 'en-US',
          enableAutomaticPunctuation: true,
          model: 'latest_short',
        },
        interimResults: true,
      })
      .on('error', console.error)
      .on('data', (data) => {
        const result = data.results[0];
        if (result) {
          socket.emit('transcription', result.alternatives[0].transcript);
        }
      });
  });

  socket.on("binaryData", (data) => {
    if (recognizeStream) {
      recognizeStream.write(data);
    }
  });

  socket.on("endStream", () => {
    if (recognizeStream) {
      recognizeStream.end();
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected");
    if (recognizeStream) {
      recognizeStream.end();
    }
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Socket.IO server running on port ${PORT}`);
});

