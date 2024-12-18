import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { SpeechClient } from '@google-cloud/speech';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Define the specific type for the recognize stream
type RecognizeStream = ReturnType<SpeechClient['streamingRecognize']>;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(cors());

// Validate Google credentials on startup
const validateGoogleCredentials = () => {
  const credentials = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credentials) {
    console.error('ERROR: GOOGLE_APPLICATION_CREDENTIALS environment variable is not set');
    return false;
  }

  try {
    const parsedCredentials = JSON.parse(credentials);
    console.log('Credentials loaded successfully');
    return true;
  } catch (error) {
    console.error('ERROR: Failed to parse Google credentials:', error);
    return false;
  }
};

const hasValidCredentials = validateGoogleCredentials();

// Basic health check endpoint that includes credentials status
app.get('/', (req, res) => {
  res.json({
    status: 'Server is running',
    googleCredentials: hasValidCredentials ? 'configured' : 'missing or invalid',
    timestamp: new Date().toISOString()
  });
});

// Add a test endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    socketio: 'enabled',
    cors: 'enabled'
  });
});

const httpServer = createServer(app);

// Error handling for HTTP server
httpServer.on('error', (error) => {
  console.error('Server error:', error);
});

const io = new Server(httpServer, {
  cors: {
    origin: '*',  // During testing, accept all origins
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Error handling for Socket.IO
io.on('error', (error) => {
  console.error('Socket.IO error:', error);
});

try {
  let speechClient: SpeechClient | undefined;
  
  if (hasValidCredentials) {
    speechClient = new SpeechClient({
      credentials: JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS || '{}'),
    });
    console.log('Successfully initialized Google Speech-to-Text client');
  } else {
    console.warn('WARNING: Speech-to-Text functionality will not be available');
  }

  io.on("connection", (socket) => {
    console.log("Client connected");

    let recognizeStream: RecognizeStream | null = null;
    let isStreamEnded = false;

    socket.on("startStream", () => {
      if (!hasValidCredentials || !speechClient) {
        socket.emit('error', 'Speech-to-Text service is not configured');
        return;
      }

      try {
        // Reset stream state
        isStreamEnded = false;
        
        recognizeStream = speechClient
          .streamingRecognize({
            config: {
              encoding: 'WEBM_OPUS',
              sampleRateHertz: 48000,
              languageCode: 'en-US',
              enableAutomaticPunctuation: true,
              model: 'latest_short',
            },
            interimResults: false,
          })
          .on('error', (error) => {
            if (error.message !== 'write after end') {
              console.error('Speech recognition error:', error);
              socket.emit('error', `Speech recognition error: ${error.message}`);
            }
          })
          .on('data', (data) => {
            const result = data.results[0];
            if (result && result.alternatives[0]) {
              socket.emit('transcription', result.alternatives[0].transcript);
            }
          })
          .on('end', () => {
            isStreamEnded = true;
            recognizeStream = null;
          });
      } catch (error) {
        console.error('Error starting stream:', error);
        socket.emit('error', 'Failed to start stream');
      }
    });

    socket.on("binaryData", (data) => {
      if (recognizeStream && !isStreamEnded) {
        try {
          recognizeStream.write(data);
        } catch (error) {
          console.error('Error writing to stream:', error);
          socket.emit('error', 'Failed to process audio data');
        }
      }
    });

    socket.on("endStream", () => {
      if (recognizeStream && !isStreamEnded) {
        try {
          isStreamEnded = true;
          recognizeStream.end();
          recognizeStream = null;
        } catch (error) {
          console.error('Error ending stream:', error);
        }
      }
    });

    socket.on("disconnect", () => {
      console.log("Client disconnected");
      if (recognizeStream && !isStreamEnded) {
        try {
          isStreamEnded = true;
          recognizeStream.end();
          recognizeStream = null;
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
    console.log('Google credentials status:', hasValidCredentials ? 'valid' : 'invalid or missing');
  });

} catch (error) {
  console.error('Fatal server error:', error);
  process.exit(1);
}

