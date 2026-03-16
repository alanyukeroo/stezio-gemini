import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import * as dotenv from 'dotenv';
import http from 'http';

dotenv.config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const API_KEY = process.env.key; // The new Vertex AI Express Mode key

if (!API_KEY) {
  console.error("CRITICAL ERROR: 'key' is not set in .env");
  process.exit(1);
}

const HOST = process.env.HOST || '0.0.0.0';
const PORT = process.env.PORT || 8080;

app.get('/health', (req, res) => {
  res.status(200).send('Proxy Server is running using Vertex AI Express API Key!');
});

wss.on('connection', async (ws: WebSocket) => {
  console.log('Frontend client connected to proxy');

  try {
    const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${API_KEY}`;
    
    const geminiWs = new WebSocket(url);

    geminiWs.on('open', () => {
      console.log('Connected to Vertex AI Live (Express Mode)');
      const setupMessage = {
        setup: {
          model: `models/gemini-2.5-flash-native-audio-preview-12-2025`,
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: "Aoede"
                }
              }
            }
          },
          systemInstruction: {
            parts: [{text: "You are Stezio Voice Co-Pilot, an AI guide focused on proper placement of a digital stethoscope. Your KEY RULE: Be extremely concise. Use short phrases. Speak only when necessary. Don't yap. Do NOT repeatedly correct the user for small deviations. Wait 3-5 seconds to see if they fix it themselves before intervening. Tone: Calm and professional. No medical advice and no diagnoses. Keep all answers under 2 sentences."}]
          }
        }
      };
      geminiWs.send(JSON.stringify(setupMessage));
    });

    geminiWs.on('message', (data: any, isBinary: boolean) => {
      // console.log("Received from Gemini. Length:", data.length, "IsBinary:", isBinary);
      // We will force it to text for the frontend
      const text = data.toString('utf-8');
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(text);
      }
    });

    geminiWs.on('close', (code, reason) => {
      console.log(`Gemini connection closed. Code: ${code} Reason: ${reason}`);
      if (ws.readyState === WebSocket.OPEN) ws.close();
    });

    ws.on('message', (message: any, isBinary: boolean) => {
      if (geminiWs.readyState === WebSocket.OPEN) {
        // Forward exactly as it came, usually frontend sends JSON strings containing base64 audio
        geminiWs.send(message.toString());
      }
    });

    ws.on('close', () => {
      console.log('Frontend client disconnected');
      if (geminiWs.readyState === WebSocket.OPEN) geminiWs.close();
    });
  } catch (error) {
    console.error("Failed to connect", error);
  }
});

server.listen(Number(PORT), HOST, () => {
  console.log(`Proxy running at ws://${HOST}:${PORT}`);
});
