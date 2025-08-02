const { Server } = require("socket.io")
const http = require("http")
const crypto = require("crypto")

const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end("WebSocket Server Running");
});
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
})

const MAX_PLAYERS = 5
const rooms = new Map()
const POT_LIMIT = 50000
const suits = ["hakam-", "dil-", "chokat-", "fuli-"]
const ranks = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13"]
const TURN_DURATION = 60 * 1000

const findExistingRoomForUser = (userId) => {
  for (const [roomId, room] of rooms) {
    const players = room.players
    if (players.find((p) => p.userId === userId)) {
      return roomId
    }
  }
  return null
}

const emitRoomUpdate = (roomId) => {
  const room = rooms.get(roomId)
  if (!room) return

  io.to(roomId).emit("room-update", {
    roomId,
    roomMoney: room.roomMoney,
    bootAmount: room.bootAmount,
    isGameOn: room.isGameOn,
    chat: room.chat.map((msg) => ({
      username: msg.username,
      profileImageURL: msg.profileImageURL,
      content: msg.content,
    })),
    players: room.players.map((p) => ({
      userId: p.userId,
      username: p.username,
      profileImageURL: p.profileImageURL,
      gameMoney: p.gameMoney,
      playing: p.playing,
      hand: p.seen && p.hand.length > 0 ? p.hand : p.hand.length > 0 ? ["?", "?", "?"] : [],
      turn: p.turn,
      turnStartTime: p.turnStartTime,
      seen: p.seen,
    })),
  })
}

const removePlayerFromRoom = (roomId, userIdOrSocketId, isBySocketId = false) => {
  const room = rooms.get(roomId)
  if (!room) return

  const index = room.players.findIndex((p) =>
    isBySocketId ? p.socketId === userIdOrSocketId : p.userId === userIdOrSocketId,
  )

  if (index === -1) return

  const removed = room.players.splice(index, 1)[0]
  console.log(`[ROOM ${roomId}] ${removed.username} ${isBySocketId ? "disconnected" : "left manually"}`)

  // If game is running and this player was playing
  if (room.isGameOn && removed.playing) {
    // Clear timeout if this was the current player
    if (removed.turn && room.turnTimeout) {
      clearTimeout(room.turnTimeout)
      room.turnTimeout = null
    }

    const remainingPlayers = room.players.filter((p) => p.playing)

    if (remainingPlayers.length <= 1) {
      // If only one or zero players left, end the game
      endGame(roomId)
      return
    } else if (removed.turn) {
      // FIXED: Properly assign turn to NEXT player when current player leaves
      console.log(`[ROOM ${roomId}] Reassigning turn after ${removed.username} left`)

      // Reset all turns first
      room.players.forEach((p) => {
        p.turn = false
        p.turnStartTime = null
      })

      // Find the next active player in sequence (after the removed player's original position)
      let nextPlayerIndex = -1
      for (let i = 0; i < room.players.length; i++) {
        const checkIndex = (index + i) % room.players.length
        const checkPlayer = room.players[checkIndex]
        if (checkPlayer && checkPlayer.playing) {
          nextPlayerIndex = checkIndex
          break
        }
      }

      if (nextPlayerIndex !== -1) {
        const nextPlayer = room.players[nextPlayerIndex]
        nextPlayer.turn = true
        room.currentTurnIndex = nextPlayerIndex
        console.log(`[ROOM ${roomId}] Turn assigned to NEXT player: ${nextPlayer.username}`)
        startTurn(roomId)
      }
    }
  }

  if (room.players.length === 0) {
    // Clear any remaining timeouts before deleting room
    if (room.turnTimeout) {
      clearTimeout(room.turnTimeout)
    }
    rooms.delete(roomId)
    console.log(`[ROOM ${roomId}] Room deleted - no players left`)
  } else {
    emitRoomUpdate(roomId)
  }
}

const newPrivateRoom = ({ userId, username, profileImageURL, gameMoney, socket }) => {
  let roomId = findExistingRoomForUser(userId)

  if (roomId) return roomId

  roomId = crypto.randomUUID()
  rooms.set(roomId, {
    players: [],
    roomMoney: 0,
    bootAmount: 500,
    isGameOn: false,
    currentTurnIndex: 0,
    turnTimeout: null,
    private: true,
    chat: [],
  })

  const room = rooms.get(roomId)
  const players = room.players

  players.push({
    userId,
    username,
    profileImageURL,
    gameMoney,
    socketId: socket.id,
    playing: false,
    hand: [],
    turn: false,
    turnStartTime: null,
    seen: false,
  })

  socket.join(roomId)
  console.log(`[ROOM ${roomId}] ${username} joined`)

  emitRoomUpdate(roomId)

  return roomId
}

const assignRoom = ({ userId, username, profileImageURL, gameMoney, socket }) => {
  let roomId = findExistingRoomForUser(userId)

  if (roomId) return roomId
  for (const [id, room] of rooms.entries()) {
    if (room.players.length < MAX_PLAYERS && !room.private) {
      roomId = id
      break
    }
  }

  if (!roomId) {
    roomId = crypto.randomUUID()
    rooms.set(roomId, {
      players: [],
      roomMoney: 0,
      bootAmount: 500,
      isGameOn: false,
      currentTurnIndex: 0,
      turnTimeout: null,
      private: false,
      chat: [],
    })
  }

  const room = rooms.get(roomId)
  const players = room.players

  players.push({
    userId,
    username,
    profileImageURL,
    gameMoney,
    socketId: socket.id,
    playing: false,
    hand: [],
    turn: false,
    turnStartTime: null,
    seen: false,
  })

  socket.join(roomId)
  console.log(`[ROOM ${roomId}] ${username} joined`)

  emitRoomUpdate(roomId)

  return roomId
}

const joinRoomById = ({ userId, username, profileImageURL, gameMoney, socket, roomId }) => {
  const room = rooms.get(roomId)
  const players = room.players

  players.push({
    userId,
    username,
    profileImageURL,
    gameMoney,
    socketId: socket.id,
    playing: false,
    hand: [],
    turn: false,
    turnStartTime: null,
    seen: false,
  })

  socket.join(roomId)
  console.log(`[ROOM ${roomId}] ${username} joined`)

  emitRoomUpdate(roomId)
}

const startGame = (roomId) => {
  const room = rooms.get(roomId)
  if (!room || room.isGameOn) return
  const eligiblePlayers = room.players.filter((p) => p.gameMoney >= room.bootAmount)
  if (eligiblePlayers.length < 2) {
    console.log(`[ROOM ${roomId}] Not enough eligible players to start the game.`)
    return
  }

  // Reset room state
  room.roomMoney = 0
  room.bootAmount = 500

  // Create and shuffle deck
  const deck = []
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push(`${suit}${rank}`)
    }
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
      ;[deck[i], deck[j]] = [deck[j], deck[i]]
  }

  // Reset all players first
  room.players.forEach((player) => {
    player.playing = false
    player.hand = []
    player.turn = false
    player.turnStartTime = null
    player.seen = false
  })

  // Deal cards to eligible players only
  for (const player of eligiblePlayers) {
    player.hand = deck.splice(0, 3)
    player.playing = true
    player.gameMoney -= room.bootAmount
    room.roomMoney += room.bootAmount
  }

  // Choose random player from the ones who actually got cards
  const randomIndex = Math.floor(Math.random() * eligiblePlayers.length)
  const currentTurnPlayer = eligiblePlayers[randomIndex]
  currentTurnPlayer.turn = true

  // Update room.currentTurnIndex to reflect actual position in room.players
  room.currentTurnIndex = room.players.findIndex((p) => p.userId === currentTurnPlayer.userId)

  io.to(roomId).emit("game-started", {
    firstTurnUserId: currentTurnPlayer.userId,
  })

  room.isGameOn = true
  startTurn(roomId)
  emitRoomUpdate(roomId)
}

const startTurn = (roomId) => {
  const room = rooms.get(roomId)
  if (!room) return

  const activePlayers = room.players.filter((p) => p.playing)
  if (activePlayers.length === 0) return

  let currentPlayer = activePlayers.find((p) => p.turn)
  if (!currentPlayer) {
    // Fallback: set first active player's turn
    currentPlayer = activePlayers[0]
    currentPlayer.turn = true
    // Update room's currentTurnIndex
    room.currentTurnIndex = room.players.findIndex((p) => p.userId === currentPlayer.userId)
  }

  currentPlayer.turnStartTime = Date.now()

  console.log(`[ROOM ${roomId}] Turn started for ${currentPlayer.username}`)

  io.to(roomId).emit("turn-started", {
    userId: currentPlayer.userId,
    turnStartTime: currentPlayer.turnStartTime,
    duration: TURN_DURATION,
  })

  if (room.turnTimeout) clearTimeout(room.turnTimeout)

  room.turnTimeout = setTimeout(() => {
    console.log(`[ROOM ${roomId}] Auto-folding due to timeout: ${currentPlayer.username}`)
    foldPlayer(roomId, currentPlayer.userId, true)
  }, TURN_DURATION)
}

const nextTurn = (roomId) => {
  const room = rooms.get(roomId)
  if (!room) return

  const activePlayers = room.players.filter((p) => p.playing)
  if (activePlayers.length <= 1) {
    endGame(roomId)
    return
  }

  // Find current player's index in activePlayers array
  const currentPlayerIndex = activePlayers.findIndex((p) => p.turn)

  // Clear current player's turn
  if (currentPlayerIndex !== -1) {
    activePlayers[currentPlayerIndex].turn = false
    activePlayers[currentPlayerIndex].turnStartTime = null
  }

  // Set next player's turn
  const nextIndex = currentPlayerIndex === -1 ? 0 : (currentPlayerIndex + 1) % activePlayers.length
  const nextPlayer = activePlayers[nextIndex]
  nextPlayer.turn = true

  // Update room's currentTurnIndex to match the actual player position
  room.currentTurnIndex = room.players.findIndex((p) => p.userId === nextPlayer.userId)

  console.log(`[ROOM ${roomId}] Turn moved to ${nextPlayer.username}`)

  if (room.turnTimeout) {
    clearTimeout(room.turnTimeout)
    room.turnTimeout = null
  }

  startTurn(roomId)
  emitRoomUpdate(roomId)
}

const foldPlayer = (roomId, userId, isAuto = false) => {
  const room = rooms.get(roomId)
  if (!room) return

  const player = room.players.find((p) => p.userId === userId)
  if (!player || !player.playing) return

  const hadTurn = player.turn
  player.playing = false
  player.turn = false
  player.turnStartTime = null

  // Always clear timeout when a player folds
  if (room.turnTimeout) {
    clearTimeout(room.turnTimeout)
    room.turnTimeout = null
  }

  const reason = isAuto ? "Auto-folded" : "Folded"
  console.log(`[ROOM ${roomId}] ${player.username} ${reason}`)

  io.to(roomId).emit("player-folded", { userId, isAuto })

  const remainingPlayers = room.players.filter((p) => p.playing)
  if (remainingPlayers.length === 1) {
    endGame(roomId)
  } else if (remainingPlayers.length > 1 && hadTurn) {
    // FIXED: Properly assign turn to NEXT player when current player folds
    console.log(`[ROOM ${roomId}] Reassigning turn after ${player.username} folded`)

    // Find the folded player's position in the original players array
    const foldedPlayerIndex = room.players.findIndex((p) => p.userId === userId)

    // Find the next active player after the folded player
    let nextPlayerIndex = -1
    for (let i = 1; i <= room.players.length; i++) {
      const checkIndex = (foldedPlayerIndex + i) % room.players.length
      const checkPlayer = room.players[checkIndex]
      if (checkPlayer && checkPlayer.playing) {
        nextPlayerIndex = checkIndex
        break
      }
    }

    if (nextPlayerIndex !== -1) {
      const nextPlayer = room.players[nextPlayerIndex]
      nextPlayer.turn = true
      room.currentTurnIndex = nextPlayerIndex
      console.log(`[ROOM ${roomId}] Turn assigned to NEXT player: ${nextPlayer.username}`)
      startTurn(roomId)
    }
  }
  emitRoomUpdate(roomId)
}

const playerAction = (roomId, userId, action, betAmount) => {
  const room = rooms.get(roomId)
  if (!room || !room.isGameOn) return

  const player = room.players.find((p) => p.userId === userId && p.turn && p.playing)
  if (!player) return

  const minBet = 500
  const maxBoot = 5000

  if (action === "fold") {
    foldPlayer(roomId, userId)
    return
  }

  if (action === "see") {
    if (player.seen) {
      // Already seen players can't see again
      io.to(player.socketId).emit("error", { message: "You have already seen your cards." })
      return
    }

    // Mark player as seen without placing any bet
    player.seen = true
    console.log(`[ROOM ${roomId}] ${player.username} saw their cards and switched to seen mode.`)

    emitRoomUpdate(roomId)
    return
  }

  if (action === "blind") {
    if (player.seen) {
      // Seen players can't play blind
      io.to(player.socketId).emit("error", { message: "Seen players cannot play blind." })
      return
    }

    const blindAmount = Math.max(minBet, Math.min(betAmount, maxBoot))
    if (player.gameMoney < blindAmount) {
      foldPlayer(roomId, userId)
      return
    }

    player.gameMoney -= blindAmount
    room.roomMoney += blindAmount
    console.log(`[ROOM ${roomId}] ${player.username} played blind: ₹${blindAmount}`)
  }

  if (action === "chaal") {
    const requiredMin = player.seen ? minBet * 2 : minBet
    const chaalAmount = Math.max(requiredMin, Math.min(betAmount, maxBoot))

    if (player.gameMoney < chaalAmount) {
      foldPlayer(roomId, userId)
      return
    }

    player.gameMoney -= chaalAmount
    room.roomMoney += chaalAmount

    // If this is the first chaal action, mark player as seen
    if (!player.seen) {
      player.seen = true
      console.log(`[ROOM ${roomId}] ${player.username} switched to seen mode.`)
    }

    console.log(`[ROOM ${roomId}] ${player.username} played chaal: ₹${chaalAmount}`)
  }

  if (room.roomMoney >= POT_LIMIT) {
    console.log(`[ROOM ${roomId}] POT LIMIT REACHED: ₹${room.roomMoney} → Ending game`)
    endGame(roomId)
    return
  }

  nextTurn(roomId)
  emitRoomUpdate(roomId)
}

const handleShowRequest = (roomId, userId) => {
  const room = rooms.get(roomId)
  if (!room || !room.isGameOn) return

  const requester = room.players.find((p) => p.userId === userId && p.playing)
  if (!requester || !requester.seen) {
    io.to(requester?.socketId).emit("error", { message: "Only seen players can request a show." })
    return
  }

  const activePlayers = room.players.filter((p) => p.playing)
  if (activePlayers.length !== 2) {
    io.to(requester.socketId).emit("error", { message: "Show can only be requested when 2 players remain." })
    return
  }

  const opponent = activePlayers.find((p) => p.userId !== userId)
  if (!opponent) return

  console.log(`[ROOM ${roomId}] Show requested by ${requester.username}. Triggering game end.`)
  endGame(roomId)
}

const handRankValue = (hand) => {
  const ranks = hand.map((card) => {
    const parts = card.split("-")
    return Number.parseInt(parts[1], 10)
  })

  const suits = hand.map((card) => card.split("-")[0])

  // Sort ranks for normal sequence checking
  const sortedRanks = [...ranks].sort((a, b) => a - b)
  const uniqueRanks = [...new Set(sortedRanks)]
  const uniqueSuits = [...new Set(suits)]

  const isTrail = uniqueRanks.length === 1

  // Check for sequences
  let isSequence = false
  let sequenceHigh = 0

  // Normal sequence
  if (sortedRanks[1] === sortedRanks[0] + 1 && sortedRanks[2] === sortedRanks[1] + 1) {
    isSequence = true
    sequenceHigh = sortedRanks[2]
  }
  // A-2-3 (Low Ace)
  else if (sortedRanks[0] === 1 && sortedRanks[1] === 2 && sortedRanks[2] === 3) {
    isSequence = true
    sequenceHigh = 3
  }
  // J-Q-K-A (High Ace) - but A is represented as 1, so check for [1, 11, 12, 13]
  else if (sortedRanks[0] === 1 && sortedRanks[1] === 11 && sortedRanks[2] === 12) {
    isSequence = true
    sequenceHigh = 14 // Treat as high ace
  }
  // Q-K-A
  else if (sortedRanks[0] === 1 && sortedRanks[1] === 12 && sortedRanks[2] === 13) {
    isSequence = true
    sequenceHigh = 14 // Treat as high ace
  }

  const isPureSequence = isSequence && uniqueSuits.length === 1
  const isColor = uniqueSuits.length === 1
  const isPair = uniqueRanks.length === 2

  const highCard = Math.max(...sortedRanks)
  const pairValue = sortedRanks.find((r) => sortedRanks.filter((x) => x === r).length === 2)

  if (isTrail) return { rank: 6, value: sortedRanks[0], handType: "Trail" }
  if (isPureSequence) return { rank: 5, value: sequenceHigh, handType: "Pure Sequence" }
  if (isSequence) return { rank: 4, value: sequenceHigh, handType: "Sequence" }
  if (isColor) return { rank: 3, value: highCard, handType: "Color" }
  if (isPair) return { rank: 2, value: pairValue, handType: "Pair" }
  return { rank: 1, value: highCard, handType: "High Card" }
}

const endGame = (roomId) => {
  const room = rooms.get(roomId)
  if (!room || !room.isGameOn) {
    console.log(`[ROOM ${roomId}] Cannot end game — either room not found or game is not running.`)
    return
  }

  const activePlayers = room.players.filter((p) => p.playing && p.hand.length === 3)
  const playerHands = Object.fromEntries(activePlayers.map((p) => [p.userId, p.hand]))

  if (activePlayers.length === 0) {
    console.log(`[ROOM ${roomId}] No active players. Ending game.`)
    room.isGameOn = false
    emitRoomUpdate(roomId)
    return
  }

  // 🏆 Determine winner
  let winner = activePlayers[0]
  let bestRank = handRankValue(winner.hand)

  for (let i = 1; i < activePlayers.length; i++) {
    const challenger = activePlayers[i]
    const challengerRank = handRankValue(challenger.hand)

    if (
      challengerRank.rank > bestRank.rank ||
      (challengerRank.rank === bestRank.rank && challengerRank.value > bestRank.value)
    ) {
      winner = challenger
      bestRank = challengerRank
    }
  }

  // 💰 Award winnings
  winner.gameMoney += room.roomMoney
  const winningAmount = room.roomMoney

  console.log(
    `[ROOM ${roomId}] ${winner.username} won the game with ${bestRank.handType} (${winner.hand.join(", ")}) and earned ₹${winningAmount}`,
  )

  // 🔄 Reset room & players
  room.isGameOn = false
  room.roomMoney = 0
  room.bootAmount = 500
  room.currentTurnIndex = 0

  room.players.forEach((player) => {
    player.playing = false
    player.hand = []
    player.turn = false
    player.turnStartTime = null
    player.seen = false
  })

  io.to(roomId).emit("game-ended", {
    winnerUserId: winner.userId,
    winnerUsername: winner.username,
    winnings: winningAmount,
    hands: playerHands,
    handType: bestRank.handType,
  })

  if (room.turnTimeout) {
    clearTimeout(room.turnTimeout)
    room.turnTimeout = null
  }

  emitRoomUpdate(roomId)
  setTimeout(() => {
    const currentRoom = rooms.get(roomId)
    if (currentRoom) {
      const eligiblePlayers = currentRoom.players.filter((p) => p.gameMoney >= currentRoom.bootAmount)
      if (eligiblePlayers.length >= 2) {
        console.log(`[ROOM ${roomId}] Starting next game automatically...`)
        startGame(roomId)
      } else {
        console.log(`[ROOM ${roomId}] Not enough eligible players for auto-restart.`)
      }
    }
  }, 5000)
}

const addchat = (roomId, username, profileImageURL, content) => {
  const room = rooms.get(roomId)
  if (!room) return;

  const MAX_CHAT_MESSAGES = 50;

  const chat = room.chat;
  chat.push({
    id: Date.now(),
    username,
    profileImageURL,
    content: content.trim(),
    timestamp: new Date().toISOString(),
  });

  if (chat.length > MAX_CHAT_MESSAGES) {
    chat.splice(0, chat.length - MAX_CHAT_MESSAGES);
  }

  emitRoomUpdate(roomId);
}

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id)

  socket.on("join-room", ({ userId, username, profileImageURL, gameMoney, isPrivate }) => {
    if (!userId || !username || !profileImageURL) {
      socket.emit("error", { message: "Missing user info" });
      return;
    }

    const roomId = isPrivate === "true"
      ? newPrivateRoom({ userId, username, profileImageURL, gameMoney, socket })
      : assignRoom({ userId, username, profileImageURL, gameMoney, socket });

    const room = rooms.get(roomId);

    socket.emit("joined-room", {
      roomId,
      players: room.players.map((p) => ({
        userId: p.userId,
        username: p.username,
        profileImageURL: p.profileImageURL,
        gameMoney: p.gameMoney,
      })),
    });

    emitRoomUpdate(roomId);

    startGame(roomId);
  });

  socket.on("join-room-by-id", ({ userId, username, profileImageURL, gameMoney, roomIdd }) => {
    if (!userId || !username || !profileImageURL) {
      socket.emit("error", { message: "Missing user info" });
      return;
    }
    const roomId = roomIdd;
    const room = rooms.get(roomId);

    if (!room) {
      socket.emit("room-not-found", { message: "Room does not exist" });
      return;
    }
    if (!(room.players.length < MAX_PLAYERS)) {
      socket.emit("room-not-found", { message: "Room is Full" });
      return;
    }
    joinRoomById({ userId, username, profileImageURL, gameMoney, socket, roomId });

    socket.emit("joined-room", {
      roomId,
      players: room.players.map((p) => ({
        userId: p.userId,
        username: p.username,
        profileImageURL: p.profileImageURL,
        gameMoney: p.gameMoney,
      })),
    });

    emitRoomUpdate(roomId);
    startGame(roomId);
  });

  socket.on("leave-game", ({ userId, roomId }) => {
    if (rooms.has(roomId)) {
      socket.leave(roomId)
      removePlayerFromRoom(roomId, userId, false)
    }
  })

  socket.on("disconnect", () => {
    for (const [roomId, room] of rooms.entries()) {
      if (room.players && room.players.find((p) => p.socketId === socket.id)) {
        socket.leave(roomId)
        removePlayerFromRoom(roomId, socket.id, true)
        break
      }
    }
  })

  socket.on("player-action", ({ roomId, userId, action, amount }) => {
    if (!roomId || !userId || !action) {
      socket.emit("error", { message: "Missing required parameters" })
      return
    }

    const room = rooms.get(roomId)
    if (!room) {
      socket.emit("error", { message: "Room not found" })
      return
    }

    playerAction(roomId, userId, action, amount)
  })

  socket.on("request-show", ({ roomId, userId }) => {
    handleShowRequest(roomId, userId)
  })

  socket.on("send-chat", ({ roomId, username, profileImageURL, content }) => {
    // Validate inputs
    if (!roomId || !username || !content) {
      socket.emit("error", { message: "Missing chat parameters" });
      return;
    }

    const room = rooms.get(roomId);
    if (!room) {
      socket.emit("error", { message: "Room not found" });
      return;
    }

    // Check if user is in the room
    const player = room.players.find(p => p.socketId === socket.id);
    if (!player) {
      socket.emit("error", { message: "You are not in this room" });
      return;
    }

    // Limit message length
    const MAX_MESSAGE_LENGTH = 200;
    const trimmedContent = content.trim();

    if (trimmedContent.length === 0) {
      return; // Don't send empty messages
    }

    if (trimmedContent.length > MAX_MESSAGE_LENGTH) {
      socket.emit("error", { message: "Message too long" });
      return;
    }

    addchat(roomId, username, profileImageURL, trimmedContent);
  })

})
const port=process.env.PORT;
server.listen(port, () => {
  console.log(`Socket.IO server running on port ${port}`)
})
