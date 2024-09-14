import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import admin, { credential } from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import * as dotenv from 'dotenv';

dotenv.config();

const serviceAccount = {
  type: 'service_account',
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'), // Replace new line escape characters,
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: 'https://accounts.google.com/o/oauth2/auth',
  token_uri: 'https://oauth2.googleapis.com/token',
  auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
  client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL,
  universe_domain: process.env.FIREBASE_UNIVERSE_DOMAIN,
};

// Initialize Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
});

const db = getFirestore(); // Initialize Firestore
const app = express();

app.use(
  cors({
    origin: '*',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
    credentials: true,
  })
);

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: 'https://chat-frontend-pink-phi.vercel.app/',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
    credentials: true,
  },
});

io.on('connection', (socket) => {
  console.log('a user connected:', socket.id);

  socket.on('join-room', async (roomId) => {
    console.log(`User ${socket.id} joined room ${roomId}`);
    socket.join(roomId);

    const messagesSnapshot = await db.collection('rooms').doc(roomId).collection('messages').get();
    const messages = messagesSnapshot.docs.map((doc) => doc.data());
    socket.emit('previousMessages', messages); // Send previous messages to the user
  });

  // Message sent and delivered logic
  socket.on('message', async (messageData) => {
    if (!messageData.message) {
      console.log(`Message from ${socket.id} is missing`);
      return;
    }
    console.log(`Message from ${socket.id} in room ${messageData.roomId}: ${messageData.message}`);

    // Store the message in Firestore and mark it as 'sent'
    const messageRef = await db
      .collection('rooms')
      .doc(messageData.roomId)
      .collection('messages')
      .add({
        senderId: socket.id,
        message: messageData.message,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        read: false,
        delivered: false, // Initially not delivered
      });

    const messageId = messageRef.id;

    // Notify the sender that the message is sent
    socket.emit('messageSent', { id: messageId });

    // Broadcast the message to others in the room (mark it as 'delivered')
    io.to(messageData.roomId).emit('message', {
      id: messageId,
      senderId: socket.id,
      message: messageData.message,
    });

    // Mark the message as 'delivered' in Firestore
    await db
      .collection('rooms')
      .doc(messageData.roomId)
      .collection('messages')
      .doc(messageId)
      .update({ delivered: true });

    // Notify the sender that the message is delivered
    socket.emit('messageDelivered', { id: messageId });
  });

  // Typing functionality
  socket.on('typing', (data) => {
    console.log(`User ${socket.id} is typing in room ${data.roomId}`);
    socket.to(data.roomId).emit('typing', { userId: socket.id });
  });

  socket.on('stopTyping', (data) => {
    console.log(`User ${socket.id} stopped typing in room ${data.roomId}`);
    socket.to(data.roomId).emit('stopTyping', { userId: socket.id });
  });

  // Marking a message as read
  socket.on('markAsRead', async (roomId, messageId) => {
    console.log(`Message ${messageId} in room ${roomId} marked as read`);

    // Update the message to mark it as read
    await db
      .collection('rooms')
      .doc(roomId)
      .collection('messages')
      .doc(messageId)
      .update({ read: true });

    // Notify other clients that the message has been read
    io.to(roomId).emit('messageRead', messageId);
  });

  socket.on('disconnect', () => {
    console.log('user disconnected:', socket.id);
  });
});

server.listen(3001, () => {
  console.log('Server listening on http://localhost:3001');
});
