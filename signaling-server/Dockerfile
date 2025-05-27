# Use the official golang image as a builder
FROM golang:1.23-alpine AS builder

# Set the working directory
WORKDIR /app

# Copy source code first (simpler approach)
COPY . .

# Download all dependencies
RUN go mod download || go mod tidy

# Build the application
RUN CGO_ENABLED=0 GOOS=linux go build -o signaling-server .

# Use a smaller image for the final container
FROM alpine:3.18

# Install CA certificates for HTTPS
RUN apk --no-cache add ca-certificates

# Set the working directory
WORKDIR /app

# Copy the binary from builder
COPY --from=builder /app/signaling-server .

# Copy static directory from builder
COPY --from=builder /app/static ./static

# Copy certificate files from builder
COPY --from=builder /app/certs ./certs

# Expose the port the app runs on
EXPOSE 8080 8443

# Command to run the application
CMD ["./signaling-server"]
