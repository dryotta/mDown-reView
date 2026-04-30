# Sample Dockerfile — uses BASENAME_MAP (no extension, basename "Dockerfile")

FROM rust:1.75-slim AS builder
WORKDIR /usr/src/mdownreview
COPY Cargo.toml Cargo.lock ./
COPY src/ ./src/
RUN cargo build --release --bin mdownreview-cli

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /usr/src/mdownreview/target/release/mdownreview-cli /usr/local/bin/

# Drop privileges
RUN useradd --create-home --shell /bin/bash mdr
USER mdr
WORKDIR /home/mdr

ENTRYPOINT ["mdownreview-cli"]
CMD ["--help"]
