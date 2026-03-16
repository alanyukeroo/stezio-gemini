import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import http from 'http';
dotenv.config();

// Create a fake HTTP proxy that acts as the websocket server
const server = http.createServer();
server.on('upgrade', (req, socket) => {
    socket.write('HTTP/1.1 101 Web Socket Protocol Handshake\r\n' +
                 'Upgrade: WebSocket\r\n' +
                 'Connection: Upgrade\r\n' +
                 '\r\n');
    socket.on('data', (d) => {
        console.log('WS Data sent by SDK:', d.toString('utf-8').slice(0, 300));
    });
});
server.listen(9991, () => {
    const ai = new GoogleGenAI({
      vertexai: true, project: 'stezio', location: 'us-central1',
      httpOptions: { baseUrl: 'ws://localhost:9991' }
    });
    ai.live.connect({ model: 'models/gemini-2.0-flash-exp' }).catch(e=>console.log);
});
