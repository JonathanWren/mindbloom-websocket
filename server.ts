import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { SpeechClient } from '@google-cloud/speech';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(cors());

// Basic health check endpoint
app.get('/', (req, res) => {
  res.send('Server is running');
});

const httpServer = createServer(app);

// Error handling for HTTP server
httpServer.on('error', (error) => {
  console.error('Server error:', error);
});

const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

// Error handling for Socket.IO
io.on('error', (error) => {
  console.error('Socket.IO error:', error);
});

try {
  const speechClient = new SpeechClient({
    credentials: JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS || '{}'),
  });

  io.on("connection", (socket) => {
    console.log("Client connected");

    let recognizeStream: any = null;

    socket.on("startStream", () => {
      try {
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
          .on('error', (error) => {
            console.error('Speech recognition error:', error);
            socket.emit('error', 'Speech recognition error occurred');
          })
          .on('data', (data) => {
            const result = data.results[0];
            if (result) {
              socket.emit('transcription', result.alternatives[0].transcript);
            }
          });
      } catch (error) {
        console.error('Error starting stream:', error);
        socket.emit('error', 'Failed to start stream');
      }
    });

    socket.on("binaryData", (data) => {
      if (recognizeStream) {
        try {
          recognizeStream.write(data);
        } catch (error) {
          console.error('Error writing to stream:', error);
          socket.emit('error', 'Failed to process audio data');
        }
      }
    });

    socket.on("endStream", () => {
      if (recognizeStream) {
        try {
          recognizeStream.end();
        } catch (error) {
          console.error('Error ending stream:', error);
        }
      }
    });

    socket.on("disconnect", () => {
      console.log("Client disconnected");
      if (recognizeStream) {
        try {
          recognizeStream.end();
        } catch (error) {
          console.error('Error ending stream on disconnect:', error);
        }
      }
    });
  });

  const PORT = process.env.PORT || 3001;
  httpServer.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log('Environment:', process.env.NODE_ENV);
    console.log('Google credentials available:', !!process.env.GOOGLE_APPLICATION_CREDENTIALS);
  });

} catch (error) {
  console.error('Fatal server error:', error);
  process.exit(1);
}

