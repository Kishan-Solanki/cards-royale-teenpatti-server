# Cards Royale Server

A real-time multiplayer card game server built with Node.js and Socket.IO.

## Features

- Real-time multiplayer card game
- Private and public room support
- Chat functionality
- Automatic game management
- Turn-based gameplay with timeouts
- Hand ranking system (Trail, Pure Sequence, Sequence, Color, Pair, High Card)

## Game Rules

- Each player gets 3 cards
- Players can play blind (without seeing cards) or chaal (after seeing cards)
- Minimum bet: ₹500, Maximum bet: ₹5000
- Pot limit: ₹50,000
- Turn duration: 60 seconds
- Show can be requested when only 2 players remain

## Installation

1. Clone the repository:
```bash
git clone <your-repo-url>
cd server
```

2. Install dependencies:
```bash
npm install
```

3. Start the server:
```bash
npm start
```

The server will run on port 3001.

## Dependencies

- `socket.io` - Real-time communication
- `crypto` - UUID generation
- `http` - HTTP server

## API Endpoints

The server uses Socket.IO for real-time communication. Key events:

- `join-room` - Join a public room
- `join-room-by-id` - Join a specific room by ID
- `new-private-room` - Create and join a private room
- `player-action` - Perform game actions (fold, see, blind, chaal)
- `request-show` - Request to show cards
- `send-chat` - Send chat message
- `leave-game` - Leave the current game

## Deployment

This server can be deployed to various platforms:

- **Heroku**: Add a `Procfile` with `web: node server.js`
- **Railway**: Connect your GitHub repo
- **Render**: Deploy as a web service
- **Vercel**: Deploy as a serverless function
- **DigitalOcean**: Deploy to a droplet

## Environment Variables

No environment variables are currently required, but you may want to add:
- `PORT` - Server port (defaults to 3001)
- `NODE_ENV` - Environment (development/production)

## License

MIT License 