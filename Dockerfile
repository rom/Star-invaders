# Build the single self-contained binary.
FROM golang:1.24-alpine AS build
WORKDIR /src

# No external modules, so there is nothing to download; copying go.mod first
# still keeps the layer cache useful if that ever changes.
COPY go.mod ./
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version=docker" -o /out/star-invaders .

# The web assets are embedded, so the runtime image needs nothing but the
# binary, a writable data directory and CA certificates.
FROM alpine:3.20
RUN apk add --no-cache ca-certificates \
 && adduser -D -u 10001 invader \
 && mkdir -p /data && chown invader /data
COPY --from=build /out/star-invaders /usr/local/bin/star-invaders
USER invader
VOLUME /data
EXPOSE 8080
ENV STAR_INVADERS_DATA=/data
HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
ENTRYPOINT ["star-invaders"]
CMD ["-addr", ":8080"]
