BINARY  := bin/star-invaders
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS := -s -w -X main.version=$(VERSION)

.PHONY: all build run dev test vet fmt lint clean docker tidy

all: build

## build: compile a single self-contained binary with the web assets embedded
build:
	@mkdir -p bin
	CGO_ENABLED=0 go build -trimpath -ldflags "$(LDFLAGS)" -o $(BINARY) .
	@echo "built $(BINARY) ($(VERSION))"

## run: build and serve on :8080
run: build
	./$(BINARY)

## dev: serve ./web from disk so front end edits need no rebuild
dev:
	go run . -dev

## test: vet, the Go suite under the race detector, and the JS logic tests
test: vet
	go test -race ./...
	@command -v node >/dev/null 2>&1 \
		&& node --test test/js/*.test.mjs \
		|| echo "node not found; skipping the JavaScript tests"

vet:
	go vet ./...

fmt:
	gofmt -w .

## lint: formatting check suitable for CI
lint:
	@test -z "$$(gofmt -l . )" || (echo "gofmt needed:"; gofmt -l .; exit 1)
	go vet ./...

tidy:
	go mod tidy

clean:
	rm -rf bin

## docker: build the container image
docker:
	docker build -t star-invaders:$(VERSION) .
