# SYNCRO v3 devcontainer image.
#
# Pins the toolchain the v3 contracts and SDK need:
#   - Node 20 (matches .nvmrc)
#   - Rust 1.91.0 (root rust-toolchain.toml) + wasm32-unknown-unknown
#   - Rust 1.81.0 (contracts/rust-toolchain.toml, used for reproducible WASM)
#   - Stellar CLI 23.0.0 (installs the `stellar` binary; also linked as `soroban`)
#   - PostgreSQL and Redis clients for stack health checks
#
# The local stack itself (Postgres, Redis, Soroban RPC, backend, mock provider)
# is started by `scripts/bootstrap.mjs` through docker-compose.yml.

ARG NODE_VERSION=20.18.1
ARG RUST_VERSION=1.91.0
ARG CONTRACTS_RUST_VERSION=1.81.0
ARG STELLAR_CLI_VERSION=23.0.0

FROM mcr.microsoft.com/devcontainers/javascript-node:20

ARG NODE_VERSION
ARG RUST_VERSION
ARG CONTRACTS_RUST_VERSION
ARG STELLAR_CLI_VERSION

USER root

# Pin Node even if the base image drifts.
RUN su node -c "source /usr/local/share/nvm/nvm.sh && nvm install ${NODE_VERSION} && nvm alias default ${NODE_VERSION}"

# Clients used by the bootstrap/readiness checks against the Compose stack.
RUN apt-get update \
    && export DEBIAN_FRONTEND=noninteractive \
    && apt-get install -y --no-install-recommends \
        postgresql-client \
        redis-tools \
        jq \
        curl \
        ca-certificates \
        libssl-dev \
        pkg-config \
    && rm -rf /var/lib/apt/lists/*

# Shared Rust install so root, node, and vscode all see the same toolchain.
ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:${PATH}

# Root toolchain (rust-toolchain.toml) plus the contracts release toolchain.
# contracts/rust-toolchain.toml pins 1.81.0 for reproducible WASM hashes, so a
# fresh Codespace must have it pre-installed rather than downloading it at test time.
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain ${RUST_VERSION} --profile minimal \
    && rustup component add rustfmt clippy --toolchain ${RUST_VERSION} \
    && rustup toolchain install ${CONTRACTS_RUST_VERSION} --profile minimal --component rustfmt --component clippy \
    && rustup target add wasm32-unknown-unknown --toolchain ${RUST_VERSION} \
    && rustup target add wasm32-unknown-unknown --toolchain ${CONTRACTS_RUST_VERSION} \
    && chmod -R a+w "${RUSTUP_HOME}" "${CARGO_HOME}"

# Stellar CLI (soroban-cli was renamed to stellar-cli). 23.0.0 ships the
# `stellar` binary; keep a `soroban` link for the docs and `npm run doctor`.
# --no-default-features skips the optional ledger/wasm-opt libraries, which
# need extra native dependencies and dominate image build time.
RUN cargo install --locked --no-default-features --version ${STELLAR_CLI_VERSION} stellar-cli \
    && ln -sf "/usr/local/cargo/bin/stellar" "/usr/local/bin/soroban"

# Supabase CLI stays available for database/RLS work.
RUN npm install -g supabase

USER node
ENV PATH="/usr/local/cargo/bin:${PATH}"
