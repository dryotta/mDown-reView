# Sample Makefile — uses BASENAME_MAP, no extension.

CARGO    := cargo
NPM      := npm
TARGET   := release
BIN_NAME := mdownreview

.PHONY: all build test lint clean install bench

all: build test

build:
	$(NPM) ci
	$(NPM) run build
	cd src-tauri && $(CARGO) build --$(TARGET)

test:
	$(NPM) run lint
	$(NPM) test
	cd src-tauri && $(CARGO) test --$(TARGET)
	$(NPM) run test:e2e

lint:
	$(NPM) run lint
	cd src-tauri && $(CARGO) clippy --all-targets -- -D warnings
	cd src-tauri && $(CARGO) fmt -- --check

bench:
	cd src-tauri && $(CARGO) bench

clean:
	rm -rf dist node_modules
	cd src-tauri && $(CARGO) clean

install: build
	mkdir -p $(HOME)/.local/bin
	install -m 0755 src-tauri/target/$(TARGET)/$(BIN_NAME) $(HOME)/.local/bin/

help:
	@echo "make build  -- build everything (frontend + tauri)"
	@echo "make test   -- run all tests + linters"
	@echo "make bench  -- run cargo benchmarks"
	@echo "make install-- install built binary to ~/.local/bin"
