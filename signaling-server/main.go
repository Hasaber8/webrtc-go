package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
)

// Simple hardcoded auth for MVP
var validUsers = map[string]string{
	"alice": "alice",
	"bob":   "bob",
}

// video chat room
type Room struct {
	clients map[*Client]bool
	mutex   sync.Mutex
}

// Create a new room with initialized map
func NewRoom() *Room {
	return &Room{
		clients: make(map[*Client]bool),
	}
}

// client info
type Client struct {
	conn     *websocket.Conn
	room     *Room
	username string
}

// handle websrtc message (diff types)
type Message struct {
	Type     string `json:"type"`     // offer, answer, candidate, join
	Payload  string `json:"payload"`  // SDP or ICE string
	Username string `json:"username"` // who sent the message
	Target   string `json:"target"`   // who should receive the message
}

// upgrading an incoming HTTP request to a WebSocket connection.
// When a client (like a browser) initiates a WebSocket connection, it first sends a regular HTTP request with special headers (like Upgrade: websocket).
// The server must acknowledge this and "upgrade" the connection from HTTP to the WebSocket protocol. That's what the Upgrader does.
var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

func handleWebsocket(room *Room, writer http.ResponseWriter, request *http.Request) {
	// Basic authentication
	username := request.URL.Query().Get("username")
	password := request.URL.Query().Get("password")

	if storedPassword, exists := validUsers[username]; !exists || storedPassword != password {
		http.Error(writer, "Unauthorized", http.StatusUnauthorized)
		return
	}

	conn, err := upgrader.Upgrade(writer, request, nil)
	if err != nil {
		log.Printf("Error upgrading connection: %v", err)
		return
	}

	client := &Client{conn: conn, room: room, username: username}
	log.Printf("New client connected: %s", username)

	room.addClient(client)

	// Broadcast join message to all clients
	joinMsg := Message{
		Type:     "join",
		Username: username,
	}
	room.broadcast(joinMsg, client)

	go client.readPump()
}

// responsible for reading messages sent by the client over the WebSocket and acting upon them.
// here we are broadcasting them to other clients via the signaling server.
func (c *Client) readPump() {
	defer func() {
		c.room.removeClient(c)
		c.conn.Close()
		log.Printf("Client disconnected: %s", c.username)
	}()

	for {
		var msg Message
		err := c.conn.ReadJSON(&msg)
		if err != nil {
			log.Printf("Error reading message from %s: %v", c.username, err)
			break
		}

		// Set sender username in case it's not set by the client
		msg.Username = c.username

		c.room.broadcast(msg, c)
	}
}

func (r *Room) addClient(c *Client) {
	// room locked
	r.mutex.Lock()
	defer r.mutex.Unlock()
	r.clients[c] = true
}

func (r *Room) removeClient(c *Client) {
	r.mutex.Lock()
	defer r.mutex.Unlock()
	delete(r.clients, c)

	// Broadcast leave message to remaining clients
	leaveMsg := Message{
		Type:     "leave",
		Username: c.username,
	}

	for client := range r.clients {
		client.conn.WriteJSON(leaveMsg)
	}
}

func (r *Room) broadcast(msg Message, sender *Client) {
	r.mutex.Lock()
	defer r.mutex.Unlock()

	log.Printf("Broadcasting message: type=%s, from=%s, to=%s",
		msg.Type, sender.username, msg.Target)

	for client := range r.clients {
		if client.username == msg.Target || msg.Type == "join" || msg.Type == "leave" {
			err := client.conn.WriteJSON(msg)
			if err != nil {
				log.Printf("Error sending to client %s: %v", client.username, err)
			}
		}
	}
}

// TURN server configuration
func getTURNCredentials(w http.ResponseWriter, r *http.Request) {
	// Basic authentication check
	username := r.URL.Query().Get("username")
	password := r.URL.Query().Get("password")

	if storedPassword, exists := validUsers[username]; !exists || storedPassword != password {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Simple TURN config for MVP
	turnConfig := map[string]interface{}{
		"iceServers": []map[string]interface{}{
			{
				"urls": []string{"stun:stun.l.google.com:19302"},
			},
			{
				"urls":       []string{"turn:your-turn-server-ip:3478"},
				"username":   "webrtc",
				"credential": "turn_password",
			},
		},
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(turnConfig)
}

func main() {
	room := NewRoom()

	// WebSocket handler
	http.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		handleWebsocket(room, w, r)
	})

	// TURN configuration endpoint
	http.HandleFunc("/turn", getTURNCredentials)

	// Serve static files
	http.Handle("/", http.FileServer(http.Dir("./static")))

	// Start HTTP server
	go func() {
		fmt.Println("HTTP Signaling server running on :8080")
		err := http.ListenAndServe(":8080", nil)
		if err != nil {
			log.Printf("HTTP ListenAndServe error: %v", err)
		}
	}()
	
	// Start HTTPS server
	fmt.Println("HTTPS Signaling server running on :8443")
	log.Printf("WebRTC signaling server started with HTTPS support")
	err := http.ListenAndServeTLS(":8443", "./certs/cert.pem", "./certs/key.pem", nil)
	if err != nil {
		log.Fatal("HTTPS ListenAndServe: ", err)
	}
}
