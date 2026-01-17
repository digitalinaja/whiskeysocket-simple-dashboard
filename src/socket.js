import { Server } from "socket.io";

function initSocket(server) {
  const io = new Server(server, {
    cors: { origin: "*" },
  });

  io.on("connection", (socket) => {
    console.log("Client connected");
    socket.emit("hello", "Welcome to WhiskeySocket!");

    socket.on("disconnect", () => {
      console.log("Client disconnected");
    });
  });

  return io;
}

export default initSocket;